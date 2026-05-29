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
async def test_plugin_match_suggests_dynamic_section_actions(app_client, make_user):
    client, fake = app_client
    user = await make_user("plugin-section-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    parsed = {
        **SAMPLE_PARSED_RESUME,
        "education": [
            SAMPLE_PARSED_RESUME["education"][0],
            {**SAMPLE_PARSED_RESUME["education"][0], "school": "南京大学"},
        ],
        "project_experience": [
            {"name": f"项目{i}", "role": "负责人", "start_date": "2024-01", "end_date": "2024-06", "achievements": [], "tech_stack": []}
            for i in range(4)
        ],
        "internship_experience": [
            SAMPLE_PARSED_RESUME["internship_experience"][0],
            {**SAMPLE_PARSED_RESUME["internship_experience"][0], "company": "美团"},
        ],
        "work_experience": [
            SAMPLE_PARSED_RESUME["work_experience"][0],
            {**SAMPLE_PARSED_RESUME["work_experience"][0], "company": "阿里云"},
        ],
        "campus_experience": [
            SAMPLE_PARSED_RESUME["campus_experience"][0],
            {**SAMPLE_PARSED_RESUME["campus_experience"][0], "organization": "研究生会"},
        ],
    }
    fake.queue_response(parsed)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    payload = _form_payload(rid)
    payload["sections"] = [
        {"name": "项目经历", "currentCount": 1, "addButton": True},
        {"name": "教育经历", "currentCount": 1, "addButton": True},
        {"name": "实习经验", "currentCount": 1, "addButton": True},
        {"name": "employment-history", "currentCount": 1, "addButton": True},
        {"name": "社会实践", "currentCount": 1, "addButton": True},
        {"name": "工作城市", "currentCount": 1, "addButton": True},
    ]
    fake.queue_response(SAMPLE_FILL_PLAN)
    resp = await client.post("/api/v1/fill-plans/plugin-match", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text

    assert resp.json()["sectionActions"] == {
        "项目经历": "add_3",
        "教育经历": "add_1",
        "实习经验": "add_1",
        "employment-history": "add_1",
        "社会实践": "add_1",
    }


@pytest.mark.asyncio
async def test_plugin_match_repairs_composite_phone_fields_from_valid_model(app_client, make_user):
    client, fake = app_client
    user = await make_user("plugin-phone-repair-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    fake.queue_response(SAMPLE_PARSED_RESUME)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    payload = _form_payload(rid)
    payload["fields"] = [
        {
            "fieldId": "phone_country",
            "label": "手机号码",
            "subLabel": "国家/地区",
            "type": "select",
            "widget": "custom-dropdown",
            "options": ["中国 +86", "中国香港 +852"],
            "groupIndex": 0,
            "groupSize": 2,
        },
        {
            "fieldId": "phone_number",
            "label": "手机号码",
            "subLabel": "手机号码",
            "type": "tel",
            "groupIndex": 1,
            "groupSize": 2,
        },
    ]
    fake.queue_response({
        "filled": {
            "phone_country": {
                "value": "13800138000",
                "confidence": 0.9,
                "reasoning": "模型误把完整手机号给了区号",
                "source": "basic_info.phone",
            },
            "phone_number": {
                "value": "待覆盖",
                "confidence": 0.5,
                "reasoning": "模型误填",
                "source": "basic_info.phone",
            },
        },
        "needs_user_input": [],
        "warnings": [],
    })
    resp = await client.post("/api/v1/fill-plans/plugin-match", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["mappings"] == {
        "phone_country": "中国 +86",
        "phone_number": "13800138000",
    }
    assert body["filled"]["phone_country"]["reasoning"] == "后端规则校正复合手机号字段"


@pytest.mark.asyncio
async def test_force_refresh_bypasses_fill_plan_cache(app_client, make_user):
    client, fake = app_client
    user = await make_user("force-refresh-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    fake.queue_response(SAMPLE_PARSED_RESUME)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    fake.queue_response(SAMPLE_FILL_PLAN)
    first = await client.post("/api/v1/fill-plans/plugin-match", headers=headers, json=_form_payload(rid))
    assert first.status_code == 200, first.text

    refreshed_plan = {
        "filled": {
            "name": {"value": "张刷新", "confidence": 1.0, "reasoning": "force", "source": "basic_info.name"}
        },
        "needs_user_input": [],
        "warnings": [],
    }
    payload = _form_payload(rid)
    payload["forceRefresh"] = True
    fake.queue_response(refreshed_plan)
    second = await client.post("/api/v1/fill-plans/plugin-match", headers=headers, json=payload)
    assert second.status_code == 200, second.text

    body = second.json()
    assert body["cache_hit"] is False
    assert body["mappings"]["name"] == "张刷新"


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
async def test_rules_fallback_maps_repeated_project_fields_by_index(app_client, make_user):
    client, fake = app_client
    user = await make_user("repeat-project-fallback-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    parsed = {
        **SAMPLE_PARSED_RESUME,
        "project_experience": [
            {
                "name": "旧项目",
                "role": "成员",
                "start_date": "2023-01",
                "end_date": "2023-03",
                "tech_stack": ["Python"],
                "achievements": ["维护旧系统"],
            },
            {
                "name": "智能投递助手",
                "role": "项目负责人",
                "start_date": "2024-01",
                "end_date": "2024-06",
                "tech_stack": ["TypeScript", "FastAPI"],
                "achievements": ["实现多招聘站点自动填写"],
            },
        ],
    }
    fake.queue_response(parsed)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    fake.queue_response({"filled": {"bad": {"value": "x", "confidence": 2}}})
    fake.queue_response({"filled": {"bad": {"value": "x", "confidence": 2}}})
    payload = _form_payload(rid)
    payload["fields"] = [
        {"fieldId": "p2_name", "label": "项目名称", "type": "text", "repeatSection": "项目经历", "repeatIndex": 1},
        {"fieldId": "p2_role", "label": "项目角色", "type": "text", "repeatSection": "项目经历", "repeatIndex": 1},
        {
            "fieldId": "p2_start",
            "label": "项目时间",
            "type": "date",
            "groupIndex": 0,
            "groupSize": 2,
            "repeatSection": "项目经历",
            "repeatIndex": 1,
        },
        {
            "fieldId": "p2_end",
            "label": "项目时间",
            "type": "date",
            "groupIndex": 1,
            "groupSize": 2,
            "repeatSection": "项目经历",
            "repeatIndex": 1,
        },
        {"fieldId": "p2_stack", "label": "技术栈", "type": "text", "repeatSection": "项目经历", "repeatIndex": 1},
        {"fieldId": "p2_result", "label": "项目成果", "type": "textarea", "repeatSection": "项目经历", "repeatIndex": 1},
    ]
    resp = await client.post("/api/v1/fill-plans/plugin-match", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["model_used"] == "fake-chat+rules-fallback"
    assert body["mappings"] == {
        "p2_name": "智能投递助手",
        "p2_role": "项目负责人",
        "p2_start": "2024-01",
        "p2_end": "2024-06",
        "p2_stack": "TypeScript、FastAPI",
        "p2_result": "实现多招聘站点自动填写",
    }
    assert body["filled"]["p2_name"]["source"] == "project_experience[1].name"
    assert body["filled"]["p2_result"]["source"] == "project_experience[1].achievements"


@pytest.mark.asyncio
async def test_rules_fallback_infers_flat_repeated_education_fields(app_client, make_user):
    client, fake = app_client
    user = await make_user("flat-repeat-fallback-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    parsed = {
        **SAMPLE_PARSED_RESUME,
        "education": [
            {
                "school": "本科大学",
                "degree": "本科",
                "major": "软件工程",
                "start_date": "2018-09",
                "end_date": "2022-06",
            },
            {
                "school": "研究生大学",
                "degree": "硕士",
                "major": "计算机科学",
                "start_date": "2022-09",
                "end_date": "2025-06",
            },
        ],
    }
    fake.queue_response(parsed)
    rid = (await client.post(
        "/api/v1/resumes", headers=headers,
        files={"file": ("r.docx", _make_docx(), "application/octet-stream")},
    )).json()["resume_id"]

    fake.queue_response({"filled": {"bad": {"value": "x", "confidence": 2}}})
    fake.queue_response({"filled": {"bad": {"value": "x", "confidence": 2}}})
    payload = _form_payload(rid)
    payload["fields"] = [
        {"fieldId": "edu1_school", "label": "学校名称", "type": "text"},
        {"fieldId": "edu1_degree", "label": "学历", "type": "select"},
        {"fieldId": "edu1_major", "label": "专业", "type": "text"},
        {"fieldId": "edu1_start", "label": "起止时间", "type": "date", "groupIndex": 0},
        {"fieldId": "edu1_end", "label": "起止时间", "type": "date", "groupIndex": 1},
        {"fieldId": "edu2_school", "label": "学校名称", "type": "text"},
        {"fieldId": "edu2_degree", "label": "学历", "type": "select"},
        {"fieldId": "edu2_major", "label": "专业", "type": "text"},
        {"fieldId": "edu2_start", "label": "起止时间", "type": "date", "groupIndex": 0},
        {"fieldId": "edu2_end", "label": "起止时间", "type": "date", "groupIndex": 1},
    ]
    resp = await client.post("/api/v1/fill-plans/plugin-match", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["model_used"] == "fake-chat+rules-fallback"
    assert body["mappings"]["edu1_school"] == "本科大学"
    assert body["mappings"]["edu2_school"] == "研究生大学"
    assert body["mappings"]["edu2_degree"] == "硕士"
    assert body["mappings"]["edu2_start"] == "2022-09"
    assert body["filled"]["edu2_school"]["source"] == "education[1].school"


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
