"""Admin-only routes."""
from __future__ import annotations

from fastapi import APIRouter

from app.adapters.models import reset_model_cache
from app.api.deps import AdminUser, ConfigSvc, DbSession
from app.schemas.admin import (
    AdminUserListResponse,
    ModelConfigPayload,
    ModelConfigUpdate,
    ModelTestResponse,
    StatsResponse,
)
from app.services.admin_service import AdminService
from app.services.config_service import SECRET_KEYS


router = APIRouter(prefix="/admin", tags=["admin"])


def _mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}****{value[-4:]}"


@router.get("/config/model", response_model=ModelConfigPayload)
async def get_model_config(_: AdminUser, cfg_svc: ConfigSvc) -> ModelConfigPayload:
    cfg = await cfg_svc.get_model_config()
    return ModelConfigPayload(
        provider=cfg.provider,  # type: ignore[arg-type]
        model_thinking_mode=cfg.model_thinking_mode,  # type: ignore[arg-type]
        glm_api_key=_mask(cfg.glm_api_key),
        glm_base_url=cfg.glm_base_url,
        glm_ocr_model=cfg.glm_ocr_model,
        glm_vision_model=cfg.glm_vision_model,
        glm_chat_model=cfg.glm_chat_model,
        glm_reasoning_model=cfg.glm_reasoning_model,
        qwen_api_key=_mask(cfg.qwen_api_key),
        qwen_base_url=cfg.qwen_base_url,
        qwen_ocr_model=cfg.qwen_ocr_model,
        qwen_vision_model=cfg.qwen_vision_model,
        qwen_chat_model=cfg.qwen_chat_model,
        qwen_reasoning_model=cfg.qwen_reasoning_model,
    )


@router.patch("/config/model", response_model=ModelConfigPayload)
async def patch_model_config(
    payload: ModelConfigUpdate,
    _: AdminUser,
    cfg_svc: ConfigSvc,
) -> ModelConfigPayload:
    updates: dict[str, str] = {}
    if payload.provider is not None:
        updates["model_provider"] = payload.provider
    if payload.model_thinking_mode is not None:
        updates["model_thinking_mode"] = payload.model_thinking_mode
    for f in (
        "glm_api_key", "glm_base_url", "glm_ocr_model", "glm_vision_model", "glm_chat_model",
        "glm_reasoning_model",
        "qwen_api_key", "qwen_base_url", "qwen_ocr_model", "qwen_vision_model", "qwen_chat_model",
        "qwen_reasoning_model",
    ):
        v = getattr(payload, f)
        if v is not None:
            updates[f] = v
    cfg = await cfg_svc.update(updates)
    reset_model_cache()
    return ModelConfigPayload(
        provider=cfg.provider,  # type: ignore[arg-type]
        model_thinking_mode=cfg.model_thinking_mode,  # type: ignore[arg-type]
        glm_api_key=_mask(cfg.glm_api_key),
        glm_base_url=cfg.glm_base_url,
        glm_ocr_model=cfg.glm_ocr_model,
        glm_vision_model=cfg.glm_vision_model,
        glm_chat_model=cfg.glm_chat_model,
        glm_reasoning_model=cfg.glm_reasoning_model,
        qwen_api_key=_mask(cfg.qwen_api_key),
        qwen_base_url=cfg.qwen_base_url,
        qwen_ocr_model=cfg.qwen_ocr_model,
        qwen_vision_model=cfg.qwen_vision_model,
        qwen_chat_model=cfg.qwen_chat_model,
        qwen_reasoning_model=cfg.qwen_reasoning_model,
    )


@router.post("/config/model/test", response_model=ModelTestResponse)
async def test_model_config(_: AdminUser, session: DbSession) -> ModelTestResponse:
    return await AdminService(session).test_model()


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(_: AdminUser, session: DbSession) -> AdminUserListResponse:
    return await AdminService(session).list_users()


@router.get("/stats", response_model=StatsResponse)
async def admin_stats(_: AdminUser, session: DbSession) -> StatsResponse:
    return await AdminService(session).stats()
