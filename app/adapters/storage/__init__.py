"""Storage backend factory."""
from __future__ import annotations

from functools import lru_cache

from app.adapters.storage.base import StorageBackend
from app.adapters.storage.local import LocalFSStorage
from app.core.config import get_settings
from app.core.exceptions import ConfigError


@lru_cache(maxsize=1)
def get_storage() -> StorageBackend:
    settings = get_settings()
    if settings.storage_backend == "local":
        return LocalFSStorage(settings.storage_local_path)
    raise ConfigError(f"Unsupported storage backend: {settings.storage_backend}")
