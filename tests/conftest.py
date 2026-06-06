"""Test configuration — shared fixtures and lifecycle hooks."""
from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio


_TEST_TMP_ROOT = Path(tempfile.mkdtemp(prefix="cv_rec_test_"))


def _configure_test_env(tmpdir) -> None:
    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{tmpdir}/test.db"
    os.environ["STORAGE_LOCAL_PATH"] = str(tmpdir / "uploads")
    os.environ["MODEL_PROVIDER"] = "glm"
    os.environ["GLM_API_KEY"] = "test-key"
    os.environ["SECRET_KEY"] = "test-secret"
    os.environ["LOG_LEVEL"] = "WARNING"
    os.environ["LOG_TO_FILE"] = "false"
    os.environ["DEBUG_CAPTURE_INVALID_MODEL_OUTPUTS"] = "false"


_configure_test_env(_TEST_TMP_ROOT)


@pytest.fixture(scope="session", autouse=True)
def _setup_test_env():
    from app.core.config import get_settings
    get_settings.cache_clear()

    yield

    shutil.rmtree(_TEST_TMP_ROOT, ignore_errors=True)


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator:
    from app.models import user, resume, fill_plan_cache, cost_log, app_config  # noqa: F401
    from app.core.db import engine, SessionLocal
    from app.models.base import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def app_client():
    """Async HTTP client targeting an in-process FastAPI app with a fresh DB.

    Yields (httpx.AsyncClient, FakeModel). The model is monkey-patched into
    the cached factory so service-layer code transparently uses it.
    """
    from httpx import AsyncClient, ASGITransport
    from app.models import user, resume, fill_plan_cache, cost_log, app_config  # noqa: F401
    from app.core.db import engine
    from app.models.base import Base
    from app.adapters.storage import get_storage
    from tests.fakes.fake_model import FakeModel

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    fake = FakeModel()
    from app.adapters import models as models_mod
    if not hasattr(models_mod, "_real_get_model"):
        models_mod._real_get_model = models_mod.get_model
    models_mod.get_model = lambda: fake  # type: ignore[assignment]
    get_storage.cache_clear()

    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, fake

    models_mod.get_model = models_mod._real_get_model  # type: ignore[assignment]
    get_storage.cache_clear()


# ---------------- helpers ----------------

@pytest_asyncio.fixture
async def make_user(app_client):
    """Factory that returns an authenticated regular user."""
    client, _ = app_client
    counter = {"n": 0}

    async def _make(username: str | None = None, password: str = "test1234") -> dict:
        counter["n"] += 1
        name = username or f"user{counter['n']}"
        resp = await client.post(
            "/api/v1/auth/user/register",
            json={"username": name, "password": password},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make


@pytest_asyncio.fixture
async def make_admin(app_client):
    """Factory that returns an authenticated admin (bootstraps the first time)."""
    client, _ = app_client

    async def _make(username: str = "admin", password: str = "admin1234") -> dict:
        resp = await client.post(
            "/api/v1/auth/admin/bootstrap",
            json={"username": username, "password": password},
        )
        if resp.status_code == 201:
            return resp.json()
        # Already exists: log in
        resp = await client.post(
            "/api/v1/auth/admin/login",
            json={"username": username, "password": password},
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    return _make
