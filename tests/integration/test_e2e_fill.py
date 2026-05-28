"""End-to-end fill plan flow with caching semantics."""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
from docx import Document

from tests.fixtures.sample_resume import SAMPLE_FILL_PLAN, SAMPLE_PARSED_RESUME


PLUGIN_SCAN_FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "plugin_scans"
    / "1779866110428_zhdbld__xiaopeng.jobs.feishu.cn.json"
)


def _make_docx() -> bytes:
    doc = Document()
    doc.add_paragraph("dummy")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _form_payload(resume_id: str | None = None) -> dict:
    return {
        "resumeId": resume_id,
        "url": "https://jobs.example.com/apply/123",
        "fields": [
            {"fieldId": "name", "label": "姓名", "type": "text", "required": True},
            {"fieldId": "phone", "label": "手机", "type": "tel", "required": True},
            {"fieldId": "email", "label": "邮箱", "type": "email", "required": True},
            {"fieldId": "height", "label": "身高(cm)", "type": "number"},
            {"fieldId": "weight", "label": "体重(kg)", "type": "number"},
        ],
    }


@pytest.mark.asyncio
async def test_fill_plan_cache_miss_then_hit(app_client, make_user):
    client, fake = app_client
    user = await make_user("dan")
    headers = {"Authorization": f"Bearer {user['token']}"}

    fake.queue_response(SAMPLE_PARSED_RESUME)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    fake.queue_response(SAMPLE_FILL_PLAN)
    r1 = await client.post("/api/v1/fill-plans", headers=headers, json=_form_payload(rid))
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["cache_hit"] is False
    assert body1["filled"]["name"]["value"] == "张三"
    assert "height" in body1["needs_user_input"]
    calls_after_first = len(fake.calls)

    r2 = await client.post("/api/v1/fill-plans", headers=headers, json=_form_payload(rid))
    assert r2.status_code == 200
    assert r2.json()["cache_hit"] is True
    assert len(fake.calls) == calls_after_first


@pytest.mark.asyncio
async def test_fill_cache_invalidated_after_resume_patch(app_client, make_user):
    client, fake = app_client
    user = await make_user("eve")
    headers = {"Authorization": f"Bearer {user['token']}"}

    fake.queue_response(SAMPLE_PARSED_RESUME)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    fake.queue_response(SAMPLE_FILL_PLAN)
    await client.post("/api/v1/fill-plans", headers=headers, json=_form_payload(rid))

    await client.patch(
        f"/api/v1/resumes/{rid}", headers=headers,
        json={"patch": {"basic_info": {"name": "张五"}}},
    )

    new_plan = {
        "filled": {
            "name": {"value": "张五", "confidence": 1.0, "reasoning": "patched", "source": "basic_info.name"},
            "phone": {"value": "13800138000", "confidence": 1.0, "reasoning": "x", "source": "basic_info.phone"},
        },
        "needs_user_input": [],
        "warnings": [],
    }
    fake.queue_response(new_plan)
    r3 = await client.post("/api/v1/fill-plans", headers=headers, json=_form_payload(rid))
    assert r3.status_code == 200
    body = r3.json()
    assert body["cache_hit"] is False, f"expected miss, got {body}"
    assert body["filled"]["name"]["value"] == "张五"


@pytest.mark.asyncio
async def test_plugin_match_returns_extension_mappings(app_client, make_user):
    client, fake = app_client
    user = await make_user("plugin-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    fake.queue_response(SAMPLE_PARSED_RESUME)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    payload = json.loads(PLUGIN_SCAN_FIXTURE.read_text(encoding="utf-8"))
    payload["resumeId"] = rid

    fake.queue_response({
        "filled": {
            "auto_3q8u9n": {
                "value": "张三",
                "confidence": 1.0,
                "reasoning": "直接来自 basic_info.name",
                "source": "basic_info.name",
            },
            "auto_7cqx2v": {
                "value": "zhangsan@example.com",
                "confidence": 1.0,
                "reasoning": "直接来自 basic_info.email",
                "source": "basic_info.email",
            },
            "auto_6l4gsj": {
                "value": None,
                "confidence": 0.0,
                "reasoning": "简历没有明确意向城市",
                "source": "",
            },
        },
        "needs_user_input": ["auto_6l4gsj"],
        "warnings": ["意向城市需要用户确认"],
    })

    resp = await client.post("/api/v1/fill-plans/plugin-match", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["mappings"] == {
        "auto_3q8u9n": "张三",
        "auto_7cqx2v": "zhangsan@example.com",
    }
    assert "auto_6l4gsj" in body["skipped"]
    assert body["sectionActions"] == {}
    assert body["filled"]["auto_3q8u9n"]["source"] == "basic_info.name"


@pytest.mark.asyncio
async def test_plugin_match_uses_rules_fallback_when_model_schema_is_invalid(app_client, make_user):
    client, fake = app_client
    user = await make_user("plugin-fallback-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    fake.queue_response(SAMPLE_PARSED_RESUME)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    fake.queue_response({"filled": {"name": {"value": "x", "confidence": 2}}})
    fake.queue_response({"filled": {"name": {"value": "x", "confidence": 2}}})
    payload = _form_payload(rid)
    payload["fields"].extend([
        {"fieldId": "skill_python", "label": "Python", "type": "checkbox", "section": "技能"},
        {"fieldId": "self_intro", "label": "自我评价", "type": "textarea", "section": "技能与自我评价"},
    ])
    resp = await client.post("/api/v1/fill-plans/plugin-match", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["mappings"]["name"] == "张三"
    assert body["mappings"]["email"] == "zhangsan@example.com"
    assert body["mappings"]["phone"] == "13800138000"
    assert body["mappings"]["skill_python"] == "Python"
    assert body["mappings"]["self_intro"] == "5年互联网后端开发经验"
    assert "height" in body["skipped"]
    assert body["model_used"] == "fake-chat+rules-fallback"
    assert body["warnings"] == ["模型输出校验失败，已使用规则匹配兜底"]


@pytest.mark.asyncio
async def test_plugin_scan_endpoint_validates_real_scan_payload(app_client, make_user):
    client, _ = app_client
    user = await make_user("plugin-scan-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    payload = json.loads(PLUGIN_SCAN_FIXTURE.read_text(encoding="utf-8"))
    resp = await client.post("/api/v1/fill-plans/plugin-scan", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["id"] == payload["id"]
    assert body["fieldCount"] == len(payload["fields"])
    assert body["path"] is None
    assert body["warnings"] == ["10 fields have empty labels"]
