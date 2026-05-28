"""Check parsed resume quality against the original file.

This script audits section 3 of E2E_SELF_CHECKLIST.md. It intentionally uses
lightweight heuristics: enough to catch regressions in common resume fields
without turning the checker into another parser.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.parsers.preprocess import detect_format, preprocess
from app.schemas.resume import ResumeData


RANK_RE = re.compile(r"(?:排名|Rank)[:：]?\s*(\d+)\s*/\s*(\d+)", re.IGNORECASE)
NOISY_TECH = {
    "validation集",
    "latam",
    "central区域",
    "deepseek api",
    "市场",
    "区域",
    "验证集",
}


@dataclass(slots=True)
class CheckResult:
    name: str
    status: str
    detail: str = ""


class QualityChecker:
    def __init__(self, *, db_path: Path, storage_path: Path, resume_id: str | None) -> None:
        self.db_path = db_path
        self.storage_path = storage_path
        self.resume_id = resume_id
        self.results: list[CheckResult] = []

    def run(self) -> int:
        row = self._load_resume()
        if row is None:
            self._print_results()
            return 1
        parsed = self._load_parsed(row)
        if parsed is None:
            self._print_results()
            return 1
        text = self._load_source_text(row)

        self._check_basic_info(parsed, text)
        self._check_education(parsed, text)
        self._check_experience(parsed, text)
        self._check_skills(parsed, text)
        self._check_facts_and_sections(parsed, text)
        self._print_results()
        return 1 if any(result.status == "FAIL" for result in self.results) else 0

    def _add(self, name: str, status: str, detail: str = "") -> None:
        self.results.append(CheckResult(name=name, status=status, detail=detail))

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _load_resume(self) -> sqlite3.Row | None:
        if not self.db_path.exists():
            self._add("resume record", "FAIL", f"DB not found: {self.db_path}")
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
            self._add("resume record", "FAIL", f"sqlite error: {exc}")
            return None
        if row is None:
            self._add("resume record", "FAIL", "no completed resume found")
            return None
        self.resume_id = row["id"]
        self._add("resume record", "PASS", f"id={row['id']}; file={row['original_filename']}")
        return row

    def _load_parsed(self, row: sqlite3.Row) -> ResumeData | None:
        try:
            obj = json.loads(row["parsed_data"]) if isinstance(row["parsed_data"], str) else row["parsed_data"]
            parsed = ResumeData.model_validate(obj)
        except Exception as exc:  # noqa: BLE001 - smoke script reports exact failure
            self._add("schema validation", "FAIL", f"{type(exc).__name__}: {str(exc)[:240]}")
            return None
        self._add("schema validation", "PASS", f"schema_version={parsed.schema_version}")
        return parsed

    def _load_source_text(self, row: sqlite3.Row) -> str:
        path = self.storage_path / row["file_storage_key"]
        if not path.exists():
            self._add("source text", "WARN", f"raw file missing: {path}")
            return ""
        fmt = detect_format(row["original_filename"])
        try:
            if fmt == "pdf":
                proc = subprocess.run(
                    ["pdftotext", "-layout", str(path), "-"],
                    capture_output=True,
                    timeout=10,
                    check=False,
                )
                if proc.returncode == 0:
                    text = proc.stdout.decode("utf-8", errors="replace")
                else:
                    text = ""
            else:
                doc = preprocess(row["original_filename"], path.read_bytes())
                text = doc.text or ""
        except Exception as exc:  # noqa: BLE001 - smoke script reports exact failure
            self._add("source text", "WARN", f"{type(exc).__name__}: {str(exc)[:160]}")
            return ""
        normalized = _norm(text)
        if normalized:
            self._add("source text", "PASS", f"{len(normalized)} chars")
        else:
            self._add("source text", "WARN", "no extractable text; image-only checks limited")
        return normalized

    def _check_basic_info(self, parsed: ResumeData, source: str) -> None:
        basic = parsed.basic_info
        if basic.name and (not source or _compact(basic.name) in _compact(source)):
            self._add("basic_info.name", "PASS", basic.name)
        else:
            self._add("basic_info.name", "FAIL", f"name={basic.name!r} not found in source text")

        source_digits = _digits(source)
        if basic.phone and _digits(basic.phone) and _digits(basic.phone) in source_digits:
            self._add("basic_info.phone", "PASS", _mask_phone(basic.phone))
        else:
            self._add("basic_info.phone", "FAIL", "phone missing or not supported by source")

        if basic.email and (not source or basic.email.lower() in source.lower()):
            self._add("basic_info.email", "PASS", _mask_email(basic.email))
        else:
            self._add("basic_info.email", "FAIL", "email missing or not supported by source")

    def _check_education(self, parsed: ResumeData, source: str) -> None:
        dates = [edu.start_date or edu.end_date or "" for edu in parsed.education]
        if dates == sorted(dates, reverse=True):
            self._add("education order", "PASS", "reverse chronological")
        else:
            self._add("education order", "FAIL", f"dates={dates}")

        source_rank = RANK_RE.search(source)
        if not source_rank:
            self._add("education.ranking", "SKIP", "no ranking pattern in source")
            return
        expected = (int(source_rank.group(1)), int(source_rank.group(2)))
        rankings = [edu.ranking for edu in parsed.education if edu.ranking]
        if any((r.rank, r.total) == expected for r in rankings):
            self._add("education.ranking", "PASS", f"{expected[0]}/{expected[1]}")
        else:
            self._add("education.ranking", "FAIL", f"expected {expected[0]}/{expected[1]}")

    def _check_experience(self, parsed: ResumeData, source: str) -> None:
        career_items = [*parsed.internship_experience, *parsed.work_experience]
        if career_items:
            self._add(
                "career_experience",
                "PASS",
                f"internship={len(parsed.internship_experience)}, work={len(parsed.work_experience)}",
            )
        else:
            self._add("career_experience", "FAIL", "internship/work empty")

        if any(marker in source for marker in ("实习", "Intern", "internship", "Internship")):
            if parsed.internship_experience:
                self._add("internship_experience", "PASS", f"{len(parsed.internship_experience)} item(s)")
            else:
                self._add("internship_experience", "FAIL", "source contains internship marker")

        if "GEO" in source:
            if any((item.department or "").upper().find("GEO") >= 0 for item in career_items):
                self._add("career department", "PASS", "GEO")
            else:
                self._add("career department", "FAIL", "source contains GEO but department missing")

        campus_markers = ["学生会", "青协", "团委", "班委", "社团"]
        if any(marker in source for marker in campus_markers):
            campus_text = _norm(" ".join(
                " ".join(filter(None, [
                    item.organization,
                    item.department,
                    item.role,
                    item.category,
                    " ".join(item.achievements),
                    " ".join(item.tags),
                ]))
                for item in parsed.campus_experience
            ))
            if any(marker in campus_text for marker in campus_markers):
                self._add("campus_experience", "PASS", f"{len(parsed.campus_experience)} item(s)")
            else:
                fact_text = _norm(" ".join(f"{fact.label} {fact.value}" for fact in parsed.facts))
                if any(marker in fact_text for marker in campus_markers):
                    self._add("campus_experience", "WARN", "only found in facts; reparse with schema 1.6")
                else:
                    self._add("campus_experience", "FAIL", "campus organization missing")

        if len(parsed.project_experience) >= 1:
            missing_titles = [
                project.name
                for project in parsed.project_experience
                if project.name and _compact(project.name) not in _compact(source)
            ]
            if not missing_titles:
                self._add("project_experience", "PASS", f"{len(parsed.project_experience)} item(s)")
            else:
                self._add("project_experience", "WARN", f"some titles not directly found: {missing_titles[:2]}")
        else:
            self._add("project_experience", "FAIL", "empty")

    def _check_skills(self, parsed: ResumeData, source: str) -> None:
        skills = parsed.skills
        required_languages = [name for name in ("Python", "SQL", "R") if name in source]
        missing_languages = [name for name in required_languages if name not in skills.programming_languages]
        if not missing_languages:
            self._add("skills.languages", "PASS", ", ".join(skills.programming_languages))
        else:
            self._add("skills.languages", "FAIL", f"missing: {missing_languages}")

        compact_source = _compact(source)
        expected_tools = [
            name
            for name in ("Microsoft Office", "Tableau")
            if _compact(name) in compact_source
        ]
        missing_tools = [name for name in expected_tools if name not in skills.tools]
        if not missing_tools:
            detail = ", ".join(skills.tools) if skills.tools else "none expected"
            self._add("skills.tools", "PASS", detail)
        else:
            self._add("skills.tools", "FAIL", f"missing: {missing_tools}")

        tech_values: list[str] = []
        for item in [*parsed.internship_experience, *parsed.work_experience, *parsed.project_experience]:
            tech_values.extend(item.tech_stack)
        lower_values = {value.lower() for value in tech_values}
        noisy = sorted(value for value in NOISY_TECH if value.lower() in lower_values)
        if noisy:
            self._add("tech_stack noise", "FAIL", f"noise={noisy}")
        else:
            self._add("tech_stack noise", "PASS", f"{len(tech_values)} tech item(s)")

    def _check_facts_and_sections(self, parsed: ResumeData, source: str) -> None:
        fact_text = _norm(" ".join(f"{fact.label} {fact.value}" for fact in parsed.facts))
        expected_fact_terms = []
        for marker, label in [
            ("每周可实习", "每周可实习"),
            ("预计入职", "预计入职"),
        ]:
            if marker in source:
                expected_fact_terms.append(label)
        missing = [label for label in expected_fact_terms if label not in fact_text]
        if not missing:
            self._add("facts reusable info", "PASS", f"{len(parsed.facts)} fact(s)")
        else:
            self._add("facts reusable info", "FAIL", f"missing: {missing}")

        section_text = _norm(" ".join(
            f"{section.title} {' '.join(section.items)}"
            for section in parsed.extra_sections
        ))
        if "爱好" in source:
            if "爱好" in section_text or "兴趣" in section_text:
                self._add("extra_sections", "PASS", "hobbies preserved")
            else:
                self._add("extra_sections", "FAIL", "hobbies section missing")
        else:
            self._add("extra_sections", "SKIP", "no titled extra section expected")

    def _print_results(self) -> None:
        width = max((len(result.name) for result in self.results), default=0)
        for result in self.results:
            detail = f" - {result.detail}" if result.detail else ""
            print(f"[{result.status:<4}] {result.name:<{width}}{detail}")
        print()
        counts: dict[str, int] = {}
        for result in self.results:
            counts[result.status] = counts.get(result.status, 0) + 1
        summary = ", ".join(f"{key}={counts[key]}" for key in sorted(counts))
        print(f"Summary: {summary}")


def _norm(value: str) -> str:
    return unicodedata.normalize("NFKC", value or "")


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", _norm(value))


def _digits(value: str | None) -> str:
    return re.sub(r"\D+", "", value or "")


def _mask_phone(value: str) -> str:
    digits = _digits(value)
    if len(digits) >= 7:
        return f"{digits[:3]}****{digits[-4:]}"
    return "***"


def _mask_email(value: str) -> str:
    if "@" not in value:
        return "***"
    first, rest = value.split("@", 1)
    return f"{first[:1]}***@{rest}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check parsed resume quality.")
    parser.add_argument("--db-path", type=Path, default=Path("data/dev.db"))
    parser.add_argument("--storage-path", type=Path, default=Path("data/uploads"))
    parser.add_argument("--resume-id", help="Audit a specific existing resume id.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    checker = QualityChecker(
        db_path=args.db_path,
        storage_path=args.storage_path,
        resume_id=args.resume_id,
    )
    return checker.run()


if __name__ == "__main__":
    sys.exit(main())
