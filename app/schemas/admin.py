"""Admin-facing schemas."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


# ---------------- model config ----------------

ModelProvider = Literal["glm", "qwen", "fake"]
ThinkingMode = Literal["enabled", "disabled"]


class ModelConfigPayload(BaseModel):
    """Editable model configuration. Secret keys are masked on read."""

    provider: ModelProvider
    model_thinking_mode: ThinkingMode = "disabled"
    glm_api_key: str = ""
    glm_base_url: str = ""
    glm_ocr_model: str = ""
    glm_vision_model: str = ""
    glm_chat_model: str = ""
    glm_reasoning_model: str = ""
    qwen_api_key: str = ""
    qwen_base_url: str = ""
    qwen_ocr_model: str = ""
    qwen_vision_model: str = ""
    qwen_chat_model: str = ""
    qwen_reasoning_model: str = ""


class ModelConfigUpdate(BaseModel):
    """Partial update — any field omitted is left unchanged."""

    provider: ModelProvider | None = None
    model_thinking_mode: ThinkingMode | None = None
    glm_api_key: str | None = None
    glm_base_url: str | None = None
    glm_ocr_model: str | None = None
    glm_vision_model: str | None = None
    glm_chat_model: str | None = None
    glm_reasoning_model: str | None = None
    qwen_api_key: str | None = None
    qwen_base_url: str | None = None
    qwen_ocr_model: str | None = None
    qwen_vision_model: str | None = None
    qwen_chat_model: str | None = None
    qwen_reasoning_model: str | None = None


class ModelTestRequest(BaseModel):
    """Optional override; if absent, current config is used."""

    provider: ModelProvider | None = None


class ModelTestResponse(BaseModel):
    ok: bool
    provider: str
    chat_model: str
    reasoning_model: str = ""
    latency_ms: int = 0
    sample: str = ""
    error: str | None = None


# ---------------- user listing ----------------


class AdminUserItem(BaseModel):
    user_id: str
    username: str
    is_admin: bool
    plan_tier: str
    created_at: datetime
    resume_count: int
    total_cost_cny: Decimal


class AdminUserListResponse(BaseModel):
    users: list[AdminUserItem]
    total: int


# ---------------- stats ----------------


class StatsResponse(BaseModel):
    total_users: int
    total_resumes: int
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_cost_cny: Decimal
    by_stage: dict[str, dict[str, float | int | str]] = Field(default_factory=dict)
    by_model: dict[str, dict[str, float | int | str]] = Field(default_factory=dict)
