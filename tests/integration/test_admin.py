"""Admin endpoint tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_bootstrap_status_starts_true(app_client):
    client, _ = app_client
    r = await client.get("/api/v1/auth/admin/bootstrap-status")
    assert r.status_code == 200
    assert r.json()["needs_bootstrap"] is True


@pytest.mark.asyncio
async def test_bootstrap_creates_admin_then_locked(app_client):
    client, _ = app_client
    r = await client.post(
        "/api/v1/auth/admin/bootstrap",
        json={"username": "admin", "password": "admin1234"},
    )
    assert r.status_code == 201
    assert r.json()["is_admin"] is True

    r2 = await client.get("/api/v1/auth/admin/bootstrap-status")
    assert r2.json()["needs_bootstrap"] is False

    # Subsequent bootstrap attempts must fail
    r3 = await client.post(
        "/api/v1/auth/admin/bootstrap",
        json={"username": "admin2", "password": "admin1234"},
    )
    assert r3.status_code == 403
    assert r3.json()["code"] == "FORBIDDEN_ADMIN_EXISTS"


@pytest.mark.asyncio
async def test_admin_login_works(app_client, make_admin):
    client, _ = app_client
    await make_admin("admin_one", "secret-pass")
    r = await client.post(
        "/api/v1/auth/admin/login",
        json={"username": "admin_one", "password": "secret-pass"},
    )
    assert r.status_code == 200
    assert r.json()["is_admin"] is True


@pytest.mark.asyncio
async def test_admin_can_view_and_update_model_config(app_client, make_admin):
    client, _ = app_client
    admin = await make_admin()
    h = {"Authorization": f"Bearer {admin['token']}"}

    r = await client.get("/api/v1/admin/config/model", headers=h)
    assert r.status_code == 200
    initial = r.json()
    assert "provider" in initial
    assert initial["model_network_mode"] == "direct"

    r = await client.patch(
        "/api/v1/admin/config/model",
        headers=h,
        json={
            "provider": "qwen",
            "model_network_mode": "proxy",
            "model_proxy_url": "http://127.0.0.1:7890",
            "qwen_api_key": "sk-test-1234567890abcdef",
            "qwen_reasoning_model": "qwen-max",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "qwen"
    assert body["model_network_mode"] == "proxy"
    assert body["model_proxy_url"] == "http://127.0.0.1:7890"
    assert body["qwen_reasoning_model"] == "qwen-max"
    assert "****" in body["qwen_api_key"]
    assert body["qwen_api_key"] != "sk-test-1234567890abcdef"


@pytest.mark.asyncio
async def test_admin_users_and_stats(app_client, make_admin, make_user):
    client, _ = app_client
    admin = await make_admin()
    await make_user("user_one")
    await make_user("user_two")

    h = {"Authorization": f"Bearer {admin['token']}"}
    r = await client.get("/api/v1/admin/users", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3  # admin + 2 users

    r = await client.get("/api/v1/admin/stats", headers=h)
    assert r.status_code == 200
    assert r.json()["total_users"] == 3


@pytest.mark.asyncio
async def test_users_me_works_for_admin_and_user(app_client, make_admin, make_user):
    client, _ = app_client
    admin = await make_admin()
    user = await make_user("regular")

    r = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert r.status_code == 200
    assert r.json()["is_admin"] is True

    r = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {user['token']}"},
    )
    assert r.status_code == 200
    assert r.json()["is_admin"] is False
