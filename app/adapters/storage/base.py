"""Storage backend protocol.

Implementations must be safe to call concurrently and idempotent on `delete`
when the key does not exist.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class StorageBackend(Protocol):
    async def save(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        """Persist `data` under `key`. Returns the storage key (often == input key)."""
        ...

    async def get(self, key: str) -> bytes:
        """Read raw bytes. Raise NotFoundError if missing."""
        ...

    async def delete(self, key: str) -> None:
        """Delete object. No-op if missing."""
        ...

    async def exists(self, key: str) -> bool:
        ...
