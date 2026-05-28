"""Model adapter protocols and shared types.

A `ChatModel` handles text-only conversations (Stage B).
A `VisionModel` additionally accepts image inputs (Stage A).
An `OCRModel` parses document/image bytes into text before Stage A.
Both return a `ModelResponse` with usage and cost metadata so the rest of
the system can stay model-agnostic.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Literal, Protocol, runtime_checkable


class ModelTier(str, Enum):
    ECONOMY = "economy"
    STANDARD = "standard"
    FLAGSHIP = "flagship"


ResponseFormat = Literal["text", "json"]


@dataclass(slots=True)
class ModelResponse:
    """Normalized result returned by every adapter."""

    content: str
    model_id: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_cny: Decimal = field(default_factory=lambda: Decimal("0"))
    latency_ms: int = 0
    raw: dict | None = None


@runtime_checkable
class ChatModel(Protocol):
    """Text-only chat protocol."""

    async def chat(
        self,
        system: str,
        user: str,
        *,
        response_format: ResponseFormat = "json",
        temperature: float = 0.0,
    ) -> ModelResponse: ...


@runtime_checkable
class VisionModel(Protocol):
    """Vision + text chat protocol. `images` accepts raw bytes or http(s) URLs."""

    async def vision_chat(
        self,
        system: str,
        user: str,
        images: list[bytes | str],
        *,
        response_format: ResponseFormat = "json",
        temperature: float = 0.0,
    ) -> ModelResponse: ...


@runtime_checkable
class OCRModel(Protocol):
    """Document layout parsing protocol for PDF/JPG/PNG OCR."""

    async def ocr_document(
        self,
        *,
        filename: str,
        content: bytes,
    ) -> ModelResponse: ...
