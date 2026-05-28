"""OCR-first parsing route tests."""
from __future__ import annotations

import pytest

from app.services.parsing_service import ParsingService
from tests.fakes.fake_model import FakeModel
from tests.fixtures.sample_resume import SAMPLE_PARSED_RESUME


@pytest.mark.asyncio
async def test_parse_with_ocr_then_structures_text():
    model = FakeModel()
    model.queue_response("# 简历\n\n姓名：Alice\n邮箱：alice@example.com")
    model.queue_response(SAMPLE_PARSED_RESUME)

    outcome = await ParsingService(model).parse_with_ocr(
        filename="resume.pdf",
        content=b"%PDF-1.4 fake",
    )

    assert outcome.data.basic_info.name == SAMPLE_PARSED_RESUME["basic_info"]["name"]
    assert outcome.response.model_id == "fake-ocr+fake-chat"
    assert [call.method for call in model.calls] == ["ocr_document", "chat"]
    assert model.calls[1].images == []
