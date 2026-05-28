"""Local filesystem storage backend.

Files are stored under `<root>/<key>` where `key` typically encodes
`user_id/resume_id/filename` for tenant isolation.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from app.core.exceptions import NotFoundError


class LocalFSStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Prevent path traversal: refuse keys with ".." segments
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root)):
            raise ValueError(f"Invalid storage key: {key}")
        return p

    async def save(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        path = self._path(key)
        await asyncio.to_thread(self._write_sync, path, data)
        return key

    @staticmethod
    def _write_sync(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    async def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise NotFoundError(f"Storage key not found: {key}", code="NOT_FOUND_FILE")
        return await asyncio.to_thread(path.read_bytes)

    async def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            await asyncio.to_thread(path.unlink)

    async def exists(self, key: str) -> bool:
        return self._path(key).exists()
