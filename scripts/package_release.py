"""Build a user-facing release zip with the cross-platform launcher."""
from __future__ import annotations

import argparse
import subprocess
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.package_extension import iter_extension_files, validate_manifest, write_zip

DEFAULT_OUTPUT = ROOT / "dist" / "cv-rec-release.zip"
EXTENSION_ZIP = ROOT / "dist" / "cv-rec-autofill-extension.zip"
RELEASE_ROOT = "cv-rec"
ROOT_FILES = (
    "README.md",
    "DOCS.md",
    "SCHEMA.md",
    "ARCHITECTURE.md",
    "RELEASE_CHECKLIST.md",
    "pyproject.toml",
    ".env.example",
    "start_cv_rec.py",
    "start_cv_rec.bat",
    "start_cv_rec.sh",
)
SOURCE_DIRS = ("app", "scripts", "web")
SKIP_PARTS = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "node_modules",
}
SKIP_SUFFIXES = (".pyc", ".pyo", ".DS_Store")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--skip-build", action="store_true", help="Package current files without rebuilding")
    args = parser.parse_args()

    if not args.skip_build:
        run(["npm", "run", "build"], cwd=ROOT / "web")
        extension_files = iter_extension_files()
        validate_manifest(extension_files)
        write_zip(extension_files, EXTENSION_ZIP)

    write_release_zip(args.output)
    print(f"Wrote {args.output}")


def write_release_zip(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative in ROOT_FILES:
            add_file(archive, ROOT / relative, relative)

        for directory in SOURCE_DIRS:
            add_tree(archive, ROOT / directory, directory)

        add_extension_runtime(archive)
        if EXTENSION_ZIP.exists():
            add_file(archive, EXTENSION_ZIP, "dist/cv-rec-autofill-extension.zip")


def add_tree(archive: zipfile.ZipFile, directory: Path, relative_root: str) -> None:
    for path in sorted(directory.rglob("*")):
        if path.is_file() and should_include(path):
            add_file(archive, path, Path(relative_root) / path.relative_to(directory))


def add_extension_runtime(archive: zipfile.ZipFile) -> None:
    extension_root = ROOT / "With_Le" / "chrome-extension"
    for path in iter_extension_files():
        relative = Path("With_Le") / "chrome-extension" / path.relative_to(extension_root)
        add_file(archive, path, relative)


def add_file(archive: zipfile.ZipFile, path: Path, relative: str | Path) -> None:
    if not path.exists():
        return
    archive.write(path, str(Path(RELEASE_ROOT) / relative))


def should_include(path: Path) -> bool:
    relative_parts = path.relative_to(ROOT).parts
    if any(part in SKIP_PARTS for part in relative_parts):
        return False
    return not path.name.endswith(SKIP_SUFFIXES)


def run(cmd: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, check=True)


if __name__ == "__main__":
    main()
