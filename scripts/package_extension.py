"""Package the Chrome extension runtime files into a review-ready zip."""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = ROOT / "With_Le" / "chrome-extension"
DEFAULT_OUTPUT = ROOT / "dist" / "cv-rec-autofill-extension.zip"
INCLUDE_DIRS = ("shared", "content", "service-worker", "popup")
INCLUDE_FILES = ("manifest.json",)
EXCLUDE_SUFFIXES = (".test.js",)


def iter_extension_files() -> list[Path]:
    files: list[Path] = []
    for name in INCLUDE_FILES:
        files.append(EXTENSION_ROOT / name)
    for directory_name in INCLUDE_DIRS:
        directory = EXTENSION_ROOT / directory_name
        files.extend(
            path
            for path in directory.rglob("*")
            if path.is_file() and not path.name.endswith(EXCLUDE_SUFFIXES)
        )
    return sorted(files, key=lambda path: path.relative_to(EXTENSION_ROOT).as_posix())


def validate_manifest(files: list[Path]) -> None:
    manifest_path = EXTENSION_ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    packaged = {path.relative_to(EXTENSION_ROOT).as_posix() for path in files}
    required = {
        manifest["action"]["default_popup"],
        manifest["background"]["service_worker"],
    }
    for entry in manifest.get("content_scripts", []):
        required.update(entry.get("js", []))
    missing = sorted(required - packaged)
    if missing:
        raise SystemExit(f"Manifest references files missing from package: {', '.join(missing)}")


def write_zip(files: list[Path], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(EXTENSION_ROOT).as_posix())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dry-run", action="store_true", help="List files without writing the zip")
    args = parser.parse_args()

    files = iter_extension_files()
    validate_manifest(files)
    if args.dry_run:
        for path in files:
            print(path.relative_to(EXTENSION_ROOT).as_posix())
        return
    write_zip(files, args.output)
    print(f"Wrote {args.output} ({len(files)} files)")


if __name__ == "__main__":
    main()
