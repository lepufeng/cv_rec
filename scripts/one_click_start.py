from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
DIST_INDEX = WEB_DIR / "dist" / "index.html"
ENV_FILE = ROOT / ".env"
ENV_EXAMPLE = ROOT / ".env.example"
PORT = int(os.environ.get("CV_REC_PORT", "8000"))
HOST = os.environ.get("CV_REC_HOST", "127.0.0.1")
APP_URL = f"http://{HOST}:{PORT}"
OPEN_BROWSER = os.environ.get("CV_REC_NO_BROWSER", "").lower() not in {"1", "true", "yes"}


def main() -> int:
    os.chdir(ROOT)
    print_header()
    ensure_env_file()
    ensure_frontend_build()
    ensure_port_available(PORT)
    server = start_backend()
    try:
        wait_for_backend(server)
        print("")
        print(f"CV Rec is running: {APP_URL}")
        print("Press Ctrl+C in this window to stop the server.")
        if OPEN_BROWSER:
            webbrowser.open(APP_URL)
        return wait_for_process(server)
    finally:
        stop_process(server)


def print_header() -> None:
    print("=" * 64)
    print("CV Rec one-click launcher")
    print(f"Project: {ROOT}")
    print("=" * 64)


def ensure_env_file() -> None:
    if ENV_FILE.exists():
        return
    if ENV_EXAMPLE.exists():
        shutil.copyfile(ENV_EXAMPLE, ENV_FILE)
        print("Created .env from .env.example")
        print("Tip: set GLM_API_KEY or QWEN_API_KEY in .env before parsing resumes.")
    else:
        ENV_FILE.write_text(
            "APP_ENV=dev\n"
            "DATABASE_URL=sqlite+aiosqlite:///./data/dev.db\n"
            "LOG_FILE_PATH=./data/logs/app.log\n",
            encoding="utf-8",
        )
        print("Created minimal .env")


def ensure_frontend_build() -> None:
    if frontend_build_is_current():
        print("Frontend build is ready.")
        return

    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError(
            "Frontend build is missing or outdated, and npm was not found. "
            "Install Node.js or use a release package that already includes web/dist."
        )

    package_lock = WEB_DIR / "package-lock.json"
    node_modules = WEB_DIR / "node_modules"
    if not node_modules.exists():
        print("Installing frontend dependencies...")
        install_cmd = [npm, "ci"] if package_lock.exists() else [npm, "install"]
        run(install_cmd, cwd=WEB_DIR)

    print("Building frontend...")
    run([npm, "run", "build"], cwd=WEB_DIR)


def frontend_build_is_current() -> bool:
    if not DIST_INDEX.exists():
        return False
    dist_time = DIST_INDEX.stat().st_mtime
    watched_paths = [
        WEB_DIR / "package.json",
        WEB_DIR / "package-lock.json",
        WEB_DIR / "vite.config.ts",
        WEB_DIR / "tsconfig.json",
        WEB_DIR / "tailwind.config.js",
        WEB_DIR / "postcss.config.js",
    ]
    watched_paths.extend((WEB_DIR / "src").rglob("*"))
    for path in watched_paths:
        if path.is_file() and path.stat().st_mtime > dist_time:
            return False
    return True


def ensure_port_available(port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        if sock.connect_ex((HOST, port)) == 0:
            raise RuntimeError(
                f"Port {port} is already in use. Stop the existing service or set CV_REC_PORT."
            )


def start_backend() -> subprocess.Popen[str]:
    env = os.environ.copy()
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        HOST,
        "--port",
        str(PORT),
    ]
    print("Starting backend and web UI...")
    return subprocess.Popen(cmd, cwd=ROOT, env=env, text=True)


def wait_for_backend(process: subprocess.Popen[str], timeout_seconds: int = 30) -> None:
    deadline = time.time() + timeout_seconds
    health_url = f"{APP_URL}/api/v1/health"
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Backend exited during startup with code {process.returncode}.")
        try:
            with urlopen(health_url, timeout=1) as response:
                if response.status == 200:
                    return
        except URLError:
            time.sleep(0.4)
    raise RuntimeError(f"Backend did not become ready within {timeout_seconds}s.")


def wait_for_process(process: subprocess.Popen[str]) -> int:
    try:
        return process.wait()
    except KeyboardInterrupt:
        print("")
        print("Stopping CV Rec...")
        return 0


def stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        process.terminate()
    else:
        process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()


def run(cmd: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, check=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Command failed with exit code {exc.returncode}: {' '.join(exc.cmd)}")
        raise SystemExit(exc.returncode)
    except Exception as exc:
        print("")
        print(f"Startup failed: {exc}")
        raise SystemExit(1)
