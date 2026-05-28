"""Authentication and isolation tests."""
from __future__ import annotations

import io

import pytest
from docx import Document

from tests.fixtures.sample_resume import SAMPLE_PARSED_RESUME


def _make_docx() -> bytes:
    doc = Document()
    doc.add_paragraph("test")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_health_open(app_client):
    client, _ = app_client
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.headers["x-request-id"]


@pytest.mark.asyncio
async def test_user_register_returns_token(app_client):
    client, _ = app_client
    r = await client.post(
        "/api/v1/auth/user/register",
        json={"username": "alice", "password": "test1234"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["is_admin"] is False
    assert body["token"]


@pytest.mark.asyncio
async def test_user_register_password_too_short(app_client):
    client, _ = app_client
    r = await client.post(
        "/api/v1/auth/user/register",
        json={"username": "alice", "password": "12"},
    )
    # FastAPI returns 400 when pydantic min_length fails.
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_user_login_with_wrong_password(app_client, make_user):
    client, _ = app_client
    await make_user("bob", "good-password")
    r = await client.post(
        "/api/v1/auth/user/login",
        json={"username": "bob", "password": "wrong"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_user_cannot_login_via_admin_portal(app_client, make_user):
    client, _ = app_client
    await make_user("carol", "test1234")
    r = await client.post(
        "/api/v1/auth/admin/login",
        json={"username": "carol", "password": "test1234"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_cannot_login_via_user_portal(app_client, make_admin):
    client, _ = app_client
    await make_admin("admin", "admin1234")
    r = await client.post(
        "/api/v1/auth/user/login",
        json={"username": "admin", "password": "admin1234"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_missing_token_blocked(app_client):
    client, _ = app_client
    r = await client.get("/api/v1/users/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_admin_blocked_from_user_endpoints(app_client, make_admin):
    client, _ = app_client
    admin = await make_admin()
    h = {"Authorization": f"Bearer {admin['token']}"}
    r = await client.get("/api/v1/resumes", headers=h)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_user_blocked_from_admin_endpoints(app_client, make_user):
    client, _ = app_client
    u = await make_user("dan")
    h = {"Authorization": f"Bearer {u['token']}"}
    r = await client.get("/api/v1/admin/users", headers=h)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_user_isolation(app_client, make_user, fake_or_none):
    client, fake = app_client
    a = await make_user("user_a")
    b = await make_user("user_b")

    fake.queue_response(SAMPLE_PARSED_RESUME)
    rid = (await client.post(
        "/api/v1/resumes",
        headers={"Authorization": f"Bearer {a['token']}"},
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    r = await client.get(
        f"/api/v1/resumes/{rid}",
        headers={"Authorization": f"Bearer {b['token']}"},
    )
    assert r.status_code == 403


@pytest.fixture
def fake_or_none(app_client):
    """Convenience accessor for the fake model the fixture set up."""
    return app_client[1]
