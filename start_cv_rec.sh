#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  exec python3 start_cv_rec.py
fi

if command -v python >/dev/null 2>&1; then
  exec python start_cv_rec.py
fi

echo "Python 3 was not found. Please install Python 3.11 or newer first."
exit 1
