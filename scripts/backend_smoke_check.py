"""Smoke-check backend fundamentals before plugin integration.

Checks the local backend prerequisites used by the Feishu recruiting flow:
- API health
- file logging
- SQLite DB presence/basic tables
- regular user register/login/me flow
- admin login/me/model-config/model-test when credentials are supplied

The script intentionally avoids printing tokens or secrets.
"""
from __future__ import annotations

import argparse
import getpass
import os
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


@dataclass(slots=True)
class CheckResult:
    name: str
    status: str
    detail: str = ""


class SmokeChecker:
    def __init__(
        self,
        *,
        base_url: str,
        db_path: Path,
        log_path: Path,
        admin_username: str | None,
        admin_password: str | None,
        test_model: bool,
        timeout: float,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.db_path = db_path
        self.log_path = log_path
        self.admin_username = admin_username
        self.admin_password = admin_password
        self.test_model = test_model
        self.client = httpx.Client(timeout=timeout)
        self.results: list[CheckResult] = []

    def close(self) -> None:
        self.client.close()

    def run(self) -> int:
        self._check_health()
        self._check_log_file()
        self._check_db()
        user_token = self._check_user_auth()
        admin_token = self._check_admin_auth()
        self._check_simultaneous_auth(user_token, admin_token)
        self._check_model_config(admin_token)
        self._print_results()
        return 1 if any(r.status == "FAIL" for r in self.results) else 0

    def _add(self, name: str, status: str, detail: str = "") -> None:
        self.results.append(CheckResult(name=name, status=status, detail=detail))

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.request(method, f"{self.base_url}{path}", **kwargs)

    def _check_health(self) -> None:
        try:
            resp = self._request("GET", "/api/v1/health")
        except httpx.HTTPError as exc:
            self._add("backend health", "FAIL", f"cannot reach backend: {exc}")
            return
        if resp.status_code == 200 and resp.json().get("status") == "ok":
            self._add("backend health", "PASS", "GET /api/v1/health returned ok")
        else:
            self._add("backend health", "FAIL", f"unexpected response {resp.status_code}: {resp.text[:160]}")

    def _check_log_file(self) -> None:
        if not self.log_path.exists():
            self._add("file logging", "FAIL", f"log file not found: {self.log_path}")
            return
        try:
            content = self.log_path.read_text(encoding="utf-8", errors="replace")[-5000:]
        except OSError as exc:
            self._add("file logging", "FAIL", f"cannot read log file: {exc}")
            return
        if "/api/v1/health" in content or "startup" in content:
            self._add("file logging", "PASS", f"log file readable: {self.log_path}")
        else:
            self._add("file logging", "WARN", f"log file readable but no recent health/startup marker: {self.log_path}")

    def _check_db(self) -> None:
        if not self.db_path.exists():
            self._add("database file", "FAIL", f"DB not found: {self.db_path}")
            return
        try:
            with sqlite3.connect(self.db_path) as conn:
                tables = {
                    row[0]
                    for row in conn.execute(
                        "select name from sqlite_master where type='table'"
                    ).fetchall()
                }
                user_count = conn.execute("select count(*) from users").fetchone()[0]
        except sqlite3.Error as exc:
            self._add("database read", "FAIL", f"sqlite error: {exc}")
            return
        required = {"users", "resumes", "cost_logs", "app_config"}
        missing = sorted(required - tables)
        if missing:
            self._add("database schema", "FAIL", f"missing tables: {', '.join(missing)}")
            return
        self._add("database read", "PASS", f"required tables present; users={user_count}")

    def _check_user_auth(self) -> str | None:
        username = f"smoke_user_{int(time.time())}"
        password = "smoke-pass-123"
        try:
            reg = self._request(
                "POST",
                "/api/v1/auth/user/register",
                json={"username": username, "password": password},
            )
            if reg.status_code != 201:
                self._add("user register", "FAIL", f"{reg.status_code}: {reg.text[:160]}")
                return None
            token = reg.json().get("token")
            login = self._request(
                "POST",
                "/api/v1/auth/user/login",
                json={"username": username, "password": password},
            )
            if login.status_code != 200:
                self._add("user login", "FAIL", f"{login.status_code}: {login.text[:160]}")
                return token
            me = self._request("GET", "/api/v1/users/me", headers=_auth(token))
        except httpx.HTTPError as exc:
            self._add("user auth flow", "FAIL", f"http error: {exc}")
            return None
        if me.status_code == 200 and me.json().get("is_admin") is False:
            self._add("user auth flow", "PASS", "register/login/users-me ok")
            return token
        self._add("user auth flow", "FAIL", f"/users/me failed {me.status_code}: {me.text[:160]}")
        return token

    def _check_admin_auth(self) -> str | None:
        if not self.admin_username or not self.admin_password:
            self._add(
                "admin auth flow",
                "SKIP",
                "set CVR_SMOKE_ADMIN_USERNAME and CVR_SMOKE_ADMIN_PASSWORD to check admin login",
            )
            return None
        try:
            login = self._request(
                "POST",
                "/api/v1/auth/admin/login",
                json={"username": self.admin_username, "password": self.admin_password},
            )
            if login.status_code != 200:
                self._add("admin login", "FAIL", f"{login.status_code}: {login.text[:160]}")
                return None
            token = login.json().get("token")
            me = self._request("GET", "/api/v1/users/me", headers=_auth(token))
        except httpx.HTTPError as exc:
            self._add("admin auth flow", "FAIL", f"http error: {exc}")
            return None
        if me.status_code == 200 and me.json().get("is_admin") is True:
            self._add("admin auth flow", "PASS", "admin login/users-me ok")
            return token
        self._add("admin auth flow", "FAIL", f"/users/me failed {me.status_code}: {me.text[:160]}")
        return token

    def _check_simultaneous_auth(self, user_token: str | None, admin_token: str | None) -> None:
        if not user_token or not admin_token:
            self._add("simultaneous user/admin auth", "SKIP", "requires both user and admin tokens")
            return
        user_me = self._request("GET", "/api/v1/users/me", headers=_auth(user_token))
        admin_me = self._request("GET", "/api/v1/users/me", headers=_auth(admin_token))
        if (
            user_me.status_code == 200
            and admin_me.status_code == 200
            and user_me.json().get("is_admin") is False
            and admin_me.json().get("is_admin") is True
        ):
            self._add("simultaneous user/admin auth", "PASS", "both role tokens valid in parallel")
            return
        self._add(
            "simultaneous user/admin auth",
            "FAIL",
            f"user={user_me.status_code}, admin={admin_me.status_code}",
        )

    def _check_model_config(self, admin_token: str | None) -> None:
        if not admin_token:
            self._add("model config", "SKIP", "requires admin credentials")
            return
        cfg = self._request("GET", "/api/v1/admin/config/model", headers=_auth(admin_token))
        if cfg.status_code != 200:
            self._add("model config", "FAIL", f"{cfg.status_code}: {cfg.text[:160]}")
            return
        body = cfg.json()
        provider = body.get("provider", "")
        vision = body.get(f"{provider}_vision_model", "") if provider else ""
        chat = body.get(f"{provider}_chat_model", "") if provider else ""
        self._add("model config", "PASS", f"provider={provider}, vision={vision}, chat={chat}")
        if not self.test_model:
            self._add("model connectivity", "SKIP", "pass --test-model to call admin model test")
            return
        test = self._request("POST", "/api/v1/admin/config/model/test", headers=_auth(admin_token))
        if test.status_code == 200 and test.json().get("ok") is True:
            self._add("model connectivity", "PASS", f"model={test.json().get('model')}")
        else:
            self._add("model connectivity", "FAIL", f"{test.status_code}: {test.text[:240]}")

    def _print_results(self) -> None:
        width = max(len(r.name) for r in self.results)
        for result in self.results:
            detail = f" - {result.detail}" if result.detail else ""
            print(f"[{result.status:<4}] {result.name:<{width}}{detail}")
        print()
        counts: dict[str, int] = {}
        for result in self.results:
            counts[result.status] = counts.get(result.status, 0) + 1
        summary = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
        print(f"Summary: {summary}")


def _auth(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token or ''}"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-check backend fundamentals.")
    parser.add_argument("--base-url", default=os.getenv("CVR_SMOKE_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--db-path", type=Path, default=Path(os.getenv("CVR_SMOKE_DB_PATH", "data/dev.db")))
    parser.add_argument("--log-path", type=Path, default=Path(os.getenv("CVR_SMOKE_LOG_PATH", "data/logs/app.log")))
    parser.add_argument("--admin-username", default=os.getenv("CVR_SMOKE_ADMIN_USERNAME"))
    parser.add_argument("--admin-password", default=os.getenv("CVR_SMOKE_ADMIN_PASSWORD"))
    parser.add_argument(
        "--prompt-admin-password",
        action="store_true",
        help="Prompt for the admin password without putting it in shell history.",
    )
    parser.add_argument("--test-model", action="store_true", help="Call /admin/config/model/test; may spend model quota.")
    parser.add_argument("--timeout", type=float, default=20.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.prompt_admin_password and not args.admin_password:
        args.admin_password = getpass.getpass("Admin password: ")
    checker = SmokeChecker(
        base_url=args.base_url,
        db_path=args.db_path,
        log_path=args.log_path,
        admin_username=args.admin_username,
        admin_password=args.admin_password,
        test_model=args.test_model,
        timeout=args.timeout,
    )
    try:
        return checker.run()
    finally:
        checker.close()


if __name__ == "__main__":
    sys.exit(main())
