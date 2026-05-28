"""Smoke-check the resume parsing chain.

Default mode audits an existing completed resume in the local SQLite DB.
With --upload-file, the script registers a temporary user, uploads the file
through the running API, waits for the synchronous parse response, then audits
the DB, storage, preprocessing, schema validation, cost log, and trace logs.

The script prints only metadata and counts, never raw resume text.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.parsers.preprocess import SUPPORTED_FORMATS, preprocess
from app.schemas.resume import ResumeData


EXPECTED_LOG_EVENTS = [
    "resume_upload_received",
    "resume_file_saved",
    "resume_preprocess_done",
    "parse_model_request_started",
    "model_response_parsed",
    "parse_schema_validated",
    "resume_parse_completed",
    "resume_cost_logged",
]


@dataclass(slots=True)
class CheckResult:
    name: str
    status: str
    detail: str = ""


class ResumeParseChainChecker:
    def __init__(
        self,
        *,
        base_url: str,
        db_path: Path,
        storage_path: Path,
        log_path: Path,
        resume_id: str | None,
        upload_file: Path | None,
        timeout: float,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.db_path = db_path
        self.storage_path = storage_path
        self.log_path = log_path
        self.resume_id = resume_id
        self.upload_file = upload_file
        self.timeout = timeout
        self.client = httpx.Client(timeout=timeout)
        self.results: list[CheckResult] = []
        self.upload_request_id: str | None = None
        self.upload_user_id: str | None = None

    def close(self) -> None:
        self.client.close()

    def run(self) -> int:
        self._check_supported_formats()
        if self.upload_file:
            self._check_health()
            self._upload_and_parse()
        row = self._load_resume()
        if row is not None:
            parsed = self._check_resume_record(row)
            self._check_original_file(row)
            self._check_preprocess(row)
            self._check_schema(parsed)
            self._check_cost_log(row)
        self._check_log_instrumentation()
        self._check_runtime_log_events()
        self._print_results()
        return 1 if any(r.status == "FAIL" for r in self.results) else 0

    def _add(self, name: str, status: str, detail: str = "") -> None:
        self.results.append(CheckResult(name=name, status=status, detail=detail))

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.request(method, f"{self.base_url}{path}", **kwargs)

    def _check_supported_formats(self) -> None:
        expected = {"pdf", "docx", "png", "jpg", "jpeg"}
        supported = set(SUPPORTED_FORMATS)
        if expected <= supported:
            self._add("supported upload formats", "PASS", ", ".join(SUPPORTED_FORMATS))
        else:
            self._add("supported upload formats", "FAIL", f"missing: {sorted(expected - supported)}")

    def _check_health(self) -> None:
        try:
            resp = self._request("GET", "/api/v1/health")
        except httpx.HTTPError as exc:
            self._add("backend health", "FAIL", f"cannot reach backend: {exc}")
            return
        if resp.status_code == 200 and resp.json().get("status") == "ok":
            self._add("backend health", "PASS", "GET /api/v1/health returned ok")
        else:
            self._add("backend health", "FAIL", f"{resp.status_code}: {resp.text[:160]}")

    def _upload_and_parse(self) -> None:
        if self.upload_file is None:
            return
        if not self.upload_file.exists():
            self._add("api upload + parse", "FAIL", f"file not found: {self.upload_file}")
            return

        username = f"parse_smoke_{int(time.time())}"
        password = "parse-smoke-pass-123"
        try:
            reg = self._request(
                "POST",
                "/api/v1/auth/user/register",
                json={"username": username, "password": password},
            )
            if reg.status_code != 201:
                self._add("temporary user", "FAIL", f"{reg.status_code}: {reg.text[:160]}")
                return
            token = reg.json().get("token")
            self.upload_user_id = reg.json().get("user_id")
            with self.upload_file.open("rb") as file_obj:
                resp = self._request(
                    "POST",
                    "/api/v1/resumes",
                    headers={"Authorization": f"Bearer {token}"},
                    files={"file": (self.upload_file.name, file_obj, "application/octet-stream")},
                )
        except httpx.HTTPError as exc:
            self._add("api upload + parse", "FAIL", f"http error: {exc}")
            return
        except OSError as exc:
            self._add("api upload + parse", "FAIL", f"file read error: {exc}")
            return

        self.upload_request_id = resp.headers.get("x-request-id")
        if resp.status_code != 201:
            self._add("api upload + parse", "FAIL", f"{resp.status_code}: {resp.text[:240]}")
            return

        body = resp.json()
        self.resume_id = body.get("resume_id")
        data = body.get("data") or {}
        basic = data.get("basic_info") or {}
        if body.get("status") == "completed" and data and not body.get("error"):
            self._add(
                "api upload + parse",
                "PASS",
                f"resume_id={self.resume_id}; name={basic.get('name') or '<empty>'}",
            )
        else:
            self._add(
                "api upload + parse",
                "FAIL",
                f"status={body.get('status')}; error={body.get('error')}",
            )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _load_resume(self) -> sqlite3.Row | None:
        if not self.db_path.exists():
            self._add("resume db record", "FAIL", f"DB not found: {self.db_path}")
            return None
        try:
            with self._connect() as conn:
                if self.resume_id:
                    row = conn.execute(
                        "select * from resumes where id = ?",
                        (self.resume_id,),
                    ).fetchone()
                else:
                    row = conn.execute(
                        "select * from resumes where parse_status = 'completed' "
                        "order by created_at desc limit 1",
                    ).fetchone()
        except sqlite3.Error as exc:
            self._add("resume db record", "FAIL", f"sqlite error: {exc}")
            return None
        if row is None:
            self._add("resume db record", "FAIL", "no matching resume found")
            return None
        self.resume_id = row["id"]
        self._add("resume db record", "PASS", f"id={row['id']}; status={row['parse_status']}")
        return row

    def _check_resume_record(self, row: sqlite3.Row) -> dict[str, Any] | None:
        parsed = _load_json(row["parsed_data"])
        if row["parse_status"] == "completed":
            self._add("parse_status completed", "PASS")
        else:
            self._add("parse_status completed", "FAIL", str(row["parse_status"]))

        if not row["parse_error"]:
            self._add("parse_error empty", "PASS")
        else:
            self._add("parse_error empty", "FAIL", str(row["parse_error"])[:240])

        if parsed:
            size = len(json.dumps(parsed, ensure_ascii=False))
            self._add("parsed_data json", "PASS", f"{size} chars")
        else:
            self._add("parsed_data json", "FAIL", "empty or invalid JSON")
        return parsed

    def _check_original_file(self, row: sqlite3.Row) -> None:
        key = row["file_storage_key"]
        if not key:
            self._add("raw file saved", "FAIL", "file_storage_key is empty")
            return
        path = self.storage_path / key
        if not path.exists():
            self._add("raw file saved", "FAIL", f"missing: {path}")
            return
        size = path.stat().st_size
        expected_size = row["file_size"]
        if expected_size and size != expected_size:
            self._add("raw file saved", "WARN", f"{path}; size={size}, db_size={expected_size}")
            return
        self._add("raw file saved", "PASS", f"{path}; {size} bytes")

    def _check_preprocess(self, row: sqlite3.Row) -> None:
        path = self.storage_path / row["file_storage_key"]
        if not path.exists():
            self._add("preprocess output", "SKIP", "raw file missing")
            return
        try:
            doc = preprocess(row["original_filename"], path.read_bytes())
        except Exception as exc:  # noqa: BLE001 - smoke script reports exact failure
            self._add("preprocess output", "FAIL", f"{type(exc).__name__}: {str(exc)[:200]}")
            return

        detail = (
            f"images={len(doc.images)}; image_bytes={sum(len(i) for i in doc.images)}; "
            f"text_chars={len(doc.text or '')}"
        )
        if row["file_format"] == "pdf":
            if doc.images and doc.text:
                self._add("pdf images + text hint", "PASS", detail)
            elif doc.images:
                self._add("pdf images + text hint", "WARN", detail)
            else:
                self._add("pdf images + text hint", "FAIL", detail)
            return
        if doc.images or doc.text:
            self._add("preprocess output", "PASS", detail)
        else:
            self._add("preprocess output", "FAIL", detail)

    def _check_schema(self, parsed: dict[str, Any] | None) -> None:
        if not parsed:
            self._add("pydantic schema", "SKIP", "parsed_data missing")
            return
        try:
            data = ResumeData.model_validate(parsed)
        except Exception as exc:  # noqa: BLE001 - smoke script reports exact failure
            self._add("pydantic schema", "FAIL", f"{type(exc).__name__}: {str(exc)[:240]}")
            return
        self._add(
            "pydantic schema",
            "PASS",
            (
                f"name={data.basic_info.name or '<empty>'}; "
                f"education={len(data.education)}; internships={len(data.internship_experience)}; "
                f"work={len(data.work_experience)}; "
                f"campus={len(data.campus_experience)}; "
                f"projects={len(data.project_experience)}; facts={len(data.facts)}; "
                f"extra_sections={len(data.extra_sections)}"
            ),
        )

    def _check_cost_log(self, row: sqlite3.Row) -> None:
        if not row["parse_model"]:
            self._add("cost log", "FAIL", "resume.parse_model is empty")
            return
        try:
            with self._connect() as conn:
                cost = conn.execute(
                    "select * from cost_logs where user_id = ? and stage = 'parsing' "
                    "and model_id = ? and input_tokens = ? and output_tokens = ? "
                    "and success = 1 order by created_at desc limit 1",
                    (
                        row["user_id"],
                        row["parse_model"],
                        row["parse_input_tokens"],
                        row["parse_output_tokens"],
                    ),
                ).fetchone()
        except sqlite3.Error as exc:
            self._add("cost log", "FAIL", f"sqlite error: {exc}")
            return
        if cost:
            self._add(
                "cost log",
                "PASS",
                f"model={cost['model_id']}; tokens={cost['input_tokens']}/{cost['output_tokens']}; cost={cost['cost_cny']}",
            )
        else:
            self._add("cost log", "WARN", "no exact matching cost_logs row; table has no resume_id link")

    def _check_log_instrumentation(self) -> None:
        files = [
            ROOT / "app/services/resume_service.py",
            ROOT / "app/services/parsing_service.py",
            ROOT / "app/adapters/models/openai_compat.py",
        ]
        content = "\n".join(
            path.read_text(encoding="utf-8", errors="replace")
            for path in files
            if path.exists()
        )
        missing = [event for event in EXPECTED_LOG_EVENTS if event not in content]
        if missing:
            self._add("trace instrumentation", "FAIL", f"missing events in code: {', '.join(missing)}")
        else:
            self._add("trace instrumentation", "PASS", "all key events exist in code")

    def _check_runtime_log_events(self) -> None:
        if not self.log_path.exists():
            self._add("runtime trace events", "FAIL", f"log file not found: {self.log_path}")
            return
        events = self._load_log_events()
        if self.upload_request_id:
            seen = {
                entry.get("event")
                for entry in events
                if entry.get("request_id") == self.upload_request_id
            }
            missing = [event for event in EXPECTED_LOG_EVENTS if event not in seen]
            if missing:
                self._add(
                    "runtime trace events",
                    "FAIL",
                    f"request_id={self.upload_request_id}; missing={', '.join(missing)}",
                )
            else:
                self._add("runtime trace events", "PASS", f"request_id={self.upload_request_id}")
            return

        if not self.resume_id:
            self._add("runtime trace events", "SKIP", "no resume_id")
            return
        seen = {
            entry.get("event")
            for entry in events
            if entry.get("resume_id") == self.resume_id
        }
        if seen:
            self._add("runtime trace events", "WARN", f"historical log events found: {sorted(seen)}")
        else:
            self._add("runtime trace events", "WARN", "no resume-specific historical trace found")

    def _load_log_events(self) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for line in self.log_path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                entries.append(obj)
        return entries

    def _print_results(self) -> None:
        width = max(len(r.name) for r in self.results)
        for result in self.results:
            detail = f" - {result.detail}" if result.detail else ""
            print(f"[{result.status:<4}] {result.name:<{width}}{detail}")
        print()
        counts: dict[str, int] = {}
        for result in self.results:
            counts[result.status] = counts.get(result.status, 0) + 1
        summary = ", ".join(f"{key}={counts[key]}" for key in sorted(counts))
        print(f"Summary: {summary}")


def _load_json(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    if not value:
        return None
    if isinstance(value, str):
        try:
            obj = json.loads(value)
        except json.JSONDecodeError:
            return None
        return obj if isinstance(obj, dict) else None
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-check resume parsing chain.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--db-path", type=Path, default=Path("data/dev.db"))
    parser.add_argument("--storage-path", type=Path, default=Path("data/uploads"))
    parser.add_argument("--log-path", type=Path, default=Path("data/logs/app.log"))
    parser.add_argument("--resume-id", help="Audit a specific existing resume id.")
    parser.add_argument("--upload-file", type=Path, help="Upload this file and call the real parser.")
    parser.add_argument("--timeout", type=float, default=300.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    checker = ResumeParseChainChecker(
        base_url=args.base_url,
        db_path=args.db_path,
        storage_path=args.storage_path,
        log_path=args.log_path,
        resume_id=args.resume_id,
        upload_file=args.upload_file,
        timeout=args.timeout,
    )
    try:
        return checker.run()
    finally:
        checker.close()


if __name__ == "__main__":
    sys.exit(main())
