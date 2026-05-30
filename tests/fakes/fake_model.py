"""FakeModel for tests — satisfies ChatModel, VisionModel, and OCRModel protocols."""
from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Callable

from app.adapters.models.base import ModelResponse


@dataclass(slots=True)
class FakeCall:
    method: str  # "chat" | "vision_chat" | "ocr_document"
    system: str
    user: str
    images: list[Any]


class FakeModel:
    """In-memory test double.

    Use `queue_response(content)` to enqueue strings the model should return.
    Each call dequeues one. If `responder` is provided, it overrides the queue.
    """

    chat_model_id = "fake-chat"
    vision_model_id = "fake-vision"
    ocr_model_id = "fake-ocr"

    def __init__(self, responder: Callable[[FakeCall], str] | None = None) -> None:
        self._queue: deque[str | Exception] = deque()
        self._responder = responder
        self.calls: list[FakeCall] = []

    def queue_response(self, content: str | dict) -> None:
        if isinstance(content, dict):
            content = json.dumps(content, ensure_ascii=False)
        self._queue.append(content)

    def queue_exception(self, exc: Exception) -> None:
        self._queue.append(exc)

    def _next_content(self, call: FakeCall) -> str:
        if self._responder is not None:
            return self._responder(call)
        if not self._queue:
            return "{}"
        item = self._queue.popleft()
        if isinstance(item, Exception):
            raise item
        return item

    async def chat(
        self,
        system: str,
        user: str,
        *,
        response_format: str = "json",
        temperature: float = 0.0,
    ) -> ModelResponse:
        call = FakeCall(method="chat", system=system, user=user, images=[])
        self.calls.append(call)
        content = self._next_content(call)
        return ModelResponse(
            content=content,
            model_id=self.chat_model_id,
            input_tokens=len(system) + len(user),
            output_tokens=len(content),
            cost_cny=Decimal("0"),
            latency_ms=1,
        )

    async def vision_chat(
        self,
        system: str,
        user: str,
        images: list,
        *,
        response_format: str = "json",
        temperature: float = 0.0,
    ) -> ModelResponse:
        call = FakeCall(method="vision_chat", system=system, user=user, images=list(images))
        self.calls.append(call)
        content = self._next_content(call)
        return ModelResponse(
            content=content,
            model_id=self.vision_model_id,
            input_tokens=len(system) + len(user) + sum(len(i) if isinstance(i, (bytes, str)) else 0 for i in images),
            output_tokens=len(content),
            cost_cny=Decimal("0"),
            latency_ms=1,
        )

    async def ocr_document(
        self,
        *,
        filename: str,
        content: bytes,
    ) -> ModelResponse:
        call = FakeCall(method="ocr_document", system="", user=filename, images=[content])
        self.calls.append(call)
        result = self._next_content(call)
        return ModelResponse(
            content=result,
            model_id=self.ocr_model_id,
            input_tokens=len(content),
            output_tokens=len(result),
            cost_cny=Decimal("0"),
            latency_ms=1,
        )
