"""Debug capture tests for invalid model outputs."""
from __future__ import annotations

import json

from app.core.config import get_settings
from app.services.fill_service import FillService


def test_invalid_fill_plan_output_is_captured_for_debug(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DEBUG_CAPTURE_INVALID_MODEL_OUTPUTS", "true")
    monkeypatch.setenv("DEBUG_INVALID_MODEL_OUTPUT_DIR", str(tmp_path))
    get_settings.cache_clear()
    try:
        raw = json.dumps({
            "filled": {
                "language": {
                    "value": {"language": "英语"},
                    "confidence": 0.9,
                    "reasoning": "模型错误地返回了对象",
                    "source": "certifications",
                },
            },
            "needs_user_input": [],
            "warnings": [],
        }, ensure_ascii=False)

        assert FillService._try_parse(raw, model="fake-chat", attempt=1) is None

        files = list(tmp_path.glob("*.json"))
        assert len(files) == 1
        payload = json.loads(files[0].read_text(encoding="utf-8"))
        assert payload["stage"] == "fill_plan"
        assert payload["reason"] == "schema_invalid"
        assert payload["model"] == "fake-chat"
        assert payload["attempt"] == 1
        assert payload["raw"] == raw
        assert payload["errors"][0]["loc"] == "filled.language.value.str"
    finally:
        get_settings.cache_clear()
