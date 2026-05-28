"""Pure-function tests for FillService internals."""
from __future__ import annotations

from app.services.fill_service import FillService, _extract_domain


def test_structure_hash_stable_under_reorder():
    fields_a = [
        {"id": "name", "label": "姓名", "type": "text"},
        {"id": "phone", "label": "手机", "type": "tel"},
    ]
    fields_b = [
        {"id": "phone", "label": "手机", "type": "tel"},
        {"id": "name", "label": "姓名", "type": "text"},
    ]
    assert FillService._structure_hash(fields_a, {}) == FillService._structure_hash(fields_b, {})


def test_structure_hash_changes_with_field_change():
    a = [{"id": "name", "label": "姓名", "type": "text"}]
    b = [{"id": "name", "label": "Name", "type": "text"}]
    assert FillService._structure_hash(a, {}) != FillService._structure_hash(b, {})


def test_extract_domain():
    assert _extract_domain("https://jobs.example.com/apply") == "jobs.example.com"
    assert _extract_domain("not-a-url") == "unknown"


def test_strip_codeblock():
    from app.services.parsing_service import _strip_codeblock

    assert _strip_codeblock("```json\n{\"a\":1}\n```") == '{"a":1}'
    assert _strip_codeblock('{"a":1}') == '{"a":1}'
    assert _strip_codeblock("```\n{}\n```") == "{}"
