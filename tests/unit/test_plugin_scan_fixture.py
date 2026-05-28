"""Real plugin scan fixture coverage."""
from __future__ import annotations

import copy
import json
from collections import Counter
from pathlib import Path

from app.schemas.fill_plan import FillPlanLLMOutput, FilledField, FillPlanRequest
from app.services.fill_service import FillService


FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "plugin_scans"
    / "1779866110428_zhdbld__xiaopeng.jobs.feishu.cn.json"
)


def _load_payload() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_xiaopeng_scan_fixture_validates_and_preserves_metadata():
    payload = _load_payload()
    req = FillPlanRequest.model_validate(payload)

    assert req.id == "1779866110428_zhdbld"
    assert req.url == "https://xiaopeng.jobs.feishu.cn/index/resume/7537574485588347178/apply"
    assert req.title == "投递简历 - 加入小鹏汽车"
    assert req.fieldCount == 39
    assert len(req.fields) == 39
    assert req.frames and len(req.frames) == 3

    assert Counter(field.type for field in req.fields) == {
        "text": 20,
        "date": 7,
        "select": 6,
        "textarea": 6,
    }
    assert Counter(field.widget for field in req.fields) == {
        "text-input": 20,
        "date-picker": 7,
        "textarea": 6,
        "aria-combobox": 4,
        "pseudo-radio": 1,
        "search-select": 1,
    }

    assert all(field.fieldId for field in req.fields)
    assert len({field.fieldId for field in req.fields}) == 39
    assert all(field.fieldFingerprint and field.fieldFingerprint.startswith("ff_") for field in req.fields)

    referral = req.fields[0]
    assert referral.fieldId == "auto_f9lnem"
    assert referral.label == "推荐方式"
    assert referral.type == "select"
    assert referral.widget == "pseudo-radio"
    assert referral.enumerable is True
    assert referral.options == ["无", "内推"]
    assert referral.groupId == "g_0"
    assert referral.groupIndex == 0
    assert referral.groupSize == 3
    assert referral.frameUrl == req.url

    referral_code = req.fields[1]
    assert referral_code.subLabel == "内推码"
    assert referral_code.placeholder == "请输入内推码"

    city = req.fields[2]
    assert city.label == "意向城市"
    assert city.widget == "search-select"
    assert city.enumerable is False
    assert city.options == []


def test_form_structure_hash_ignores_ephemeral_auto_field_ids():
    payload = _load_payload()
    req = FillPlanRequest.model_validate(payload)
    dumped = [field.model_dump(mode="json", exclude_none=True) for field in req.fields]
    baseline = FillService._structure_hash(dumped, {})

    changed = copy.deepcopy(payload)
    for index, field in enumerate(changed["fields"]):
        field["fieldId"] = f"auto_changed_{index}"
    changed_req = FillPlanRequest.model_validate(changed)
    changed_dumped = [field.model_dump(mode="json", exclude_none=True) for field in changed_req.fields]

    assert [field.fieldFingerprint for field in changed_req.fields] == [
        field.fieldFingerprint for field in req.fields
    ]
    assert FillService._structure_hash(changed_dumped, {}) == baseline


def test_form_structure_hash_changes_when_real_structure_changes():
    payload = _load_payload()
    req = FillPlanRequest.model_validate(payload)
    baseline = FillService._structure_hash(
        [field.model_dump(mode="json", exclude_none=True) for field in req.fields],
        {},
    )

    changed = copy.deepcopy(payload)
    changed["fields"][0]["options"] = ["无", "内推", "猎头推荐"]
    changed_req = FillPlanRequest.model_validate(changed)

    assert FillService._structure_hash(
        [field.model_dump(mode="json", exclude_none=True) for field in changed_req.fields],
        {},
    ) != baseline


def test_fill_plan_missing_fields_are_marked_needs_input():
    plan = FillPlanLLMOutput(
        filled={
            "auto_name": FilledField(
                value="张三",
                confidence=1.0,
                reasoning="matched",
                source="basic_info.name",
            )
        },
        needs_user_input=["auto_email"],
    )

    completed = FillService._ensure_field_coverage(
        plan,
        ["auto_name", "auto_email", "auto_city"],
    )

    assert completed.needs_user_input == ["auto_email", "auto_city"]
