from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"
MARKER = VENV_DIR / ".cv_rec_backend_installed"


def main() -> int:
    os.chdir(ROOT)
    print("=" * 64)
    print("CV Rec cross-platform launcher")
    print("=" * 64)
    ensure_python_version()
    venv_python = ensure_venv()
    ensure_backend_dependencies(venv_python)
    return subprocess.call([str(venv_python), str(ROOT / "scripts" / "one_click_start.py")])


def ensure_python_version() -> None:
    if sys.version_info >= (3, 11):
        return
    version = ".".join(str(part) for part in sys.version_info[:3])
    raise RuntimeError(f"Python 3.11 or newer is required. Current version: {version}")


def ensure_venv() -> Path:
    python_path = venv_python_path()
    if python_path.exists():
        return python_path

    print("Creating Python virtual environment...")
    subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)
    return python_path


def ensure_backend_dependencies(python_path: Path) -> None:
    pyproject = ROOT / "pyproject.toml"
    needs_install = not MARKER.exists()
    if MARKER.exists() and pyproject.exists():
        needs_install = pyproject.stat().st_mtime > MARKER.stat().st_mtime

    if not needs_install:
        print("Backend dependencies are ready.")
        return

    print("Installing backend dependencies...")
    subprocess.run([str(python_path), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    subprocess.run([str(python_path), "-m", "pip", "install", "-e", "."], cwd=ROOT, check=True)
    MARKER.write_text("ok\n", encoding="utf-8")


def venv_python_path() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print("")
        print(f"Command failed with exit code {exc.returncode}: {' '.join(map(str, exc.cmd))}")
        raise SystemExit(exc.returncode)
    except KeyboardInterrupt:
        print("")
        print("Stopped.")
        raise SystemExit(0)
