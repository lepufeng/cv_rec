"""Stage B: build a smart fill plan for a webpage form.

The service:
1. Loads the user's parsed_data (referenced or default resume).
2. Computes a stable hash of the form structure for caching.
3. Returns the cached plan if (user, resume, hash) matches and resume_data_version is current.
4. Otherwise calls the LLM, validates output against `FillPlanLLMOutput`,
   persists the cache row, and writes a CostLog.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import urlparse

from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.models.base import ChatModel
from app.core.config import get_settings
from app.core.exceptions import BusinessError, ModelError, NotFoundError
from app.core.logging import get_logger
from app.models.cost_log import CostLog
from app.models.fill_plan_cache import FillPlanCache
from app.prompts.fill_form import (
    STRICT_RETRY_SUFFIX,
    SYSTEM_PROMPT,
    build_user_prompt,
)
from app.repositories.cost_log_repo import CostLogRepository
from app.repositories.fill_cache_repo import FillPlanCacheRepository
from app.repositories.resume_repo import ResumeRepository
from app.schemas.fill_plan import (
    FillPlanLLMOutput,
    FillPlanRequest,
    FillPlanResponse,
)


log = get_logger("fill_service")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FillService:
    def __init__(self, session: AsyncSession, model: ChatModel) -> None:
        self.session = session
        self.model = model
        self.cache_repo = FillPlanCacheRepository(session)
        self.resume_repo = ResumeRepository(session)
        self.cost_repo = CostLogRepository(session)

    # ---------------- public ----------------
    async def create_plan(self, user_id: str, request: FillPlanRequest) -> FillPlanResponse:
        # 1. Resolve resume
        resume = None
        if request.resumeId:
            resume = await self.resume_repo.get(request.resumeId)
            if resume is None or resume.user_id != user_id:
                raise NotFoundError("Resume not found", code="NOT_FOUND_RESUME")
        else:
            resume = await self.resume_repo.latest_for_user(user_id)
            if resume is None:
                raise NotFoundError("No resume on file. Upload one first.", code="NOT_FOUND_RESUME")

        if resume.parse_status != "completed" or resume.parsed_data is None:
            raise BusinessError(
                "Resume is not yet parsed",
                code="BUSINESS_RESUME_NOT_PARSED",
            )
        effective_thinking_mode = self._apply_thinking_mode(request.thinkingMode)

        # 2. Cache lookup
        site_domain = _extract_domain(request.url)
        form_field_ids = [field.fieldId for field in request.fields]
        form_fields_dump = [f.model_dump(mode="json", exclude_none=True) for f in request.fields]
        structure_hash = self._structure_hash(
            form_fields_dump,
            request.user_overrides,
            effective_thinking_mode,
        )

        cached = await self.cache_repo.get(
            user_id=user_id,
            resume_id=resume.id,
            form_structure_hash=structure_hash,
        )
        if cached and cached.resume_data_version == resume.parsed_data_version:
            await self.cache_repo.increment_hit(cached)
            log.info(
                "fill_cache_hit",
                user_id=user_id,
                resume_id=resume.id,
                thinking_mode=effective_thinking_mode,
            )
            cached_plan = self._ensure_field_coverage(
                FillPlanLLMOutput.model_validate(cached.plan_data),
                form_field_ids,
            )
            return FillPlanResponse(
                plan_id=cached.id,
                cache_hit=True,
                filled=cached_plan.filled,
                needs_user_input=cached_plan.needs_user_input,
                warnings=cached_plan.warnings,
            )

        # 3. Call LLM
        plan, response = await self._invoke_model(
            resume_data=resume.parsed_data,
            form_fields=form_fields_dump,
            user_overrides=request.user_overrides,
        )
        plan = self._ensure_field_coverage(plan, form_field_ids)

        # 4. Persist cache row
        ttl_days = get_settings().fill_plan_cache_ttl_days
        cache_row = FillPlanCache(
            user_id=user_id,
            resume_id=resume.id,
            resume_data_version=resume.parsed_data_version,
            site_domain=site_domain,
            form_structure_hash=structure_hash,
            plan_data=plan.model_dump(mode="json"),
            expires_at=_utcnow() + timedelta(days=ttl_days),
        )
        await self.cache_repo.add(cache_row)

        # 5. CostLog
        await self.cost_repo.add(CostLog(
            user_id=user_id,
            stage="filling",
            model_id=response.model_id,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            cost_cny=response.cost_cny,
            latency_ms=response.latency_ms,
            success=True,
        ))

        return FillPlanResponse(
            plan_id=cache_row.id,
            filled=plan.filled,
            needs_user_input=plan.needs_user_input,
            warnings=plan.warnings,
            cache_hit=False,
            model_used=response.model_id,
            cost_cny=response.cost_cny,
        )

    # ---------------- internals ----------------
    async def _invoke_model(
        self,
        *,
        resume_data: dict,
        form_fields: list[dict],
        user_overrides: dict[str, str],
    ) -> tuple[FillPlanLLMOutput, "ModelResponseLike"]:
        from app.adapters.models.base import ModelResponse

        user_prompt = build_user_prompt(resume_data, form_fields, user_overrides)
        response: ModelResponse = await self.model.chat(
            system=SYSTEM_PROMPT,
            user=user_prompt,
            response_format="json",
            temperature=0.0,
        )
        plan = self._try_parse(response.content)
        if plan is not None:
            return plan, response

        log.warning("fill_first_attempt_invalid", model=response.model_id)
        response2 = await self.model.chat(
            system=SYSTEM_PROMPT + STRICT_RETRY_SUFFIX,
            user=user_prompt,
            response_format="json",
            temperature=0.0,
        )
        plan2 = self._try_parse(response2.content)
        if plan2 is None:
            raise ModelError(
                "Fill plan failed schema validation after retry",
                code="MODEL_SCHEMA_INVALID",
            )
        merged = ModelResponse(
            content=response2.content,
            model_id=response2.model_id,
            input_tokens=response.input_tokens + response2.input_tokens,
            output_tokens=response.output_tokens + response2.output_tokens,
            cost_cny=response.cost_cny + response2.cost_cny,
            latency_ms=response.latency_ms + response2.latency_ms,
        )
        return plan2, merged

    @staticmethod
    def _try_parse(raw: str) -> FillPlanLLMOutput | None:
        text = raw.strip()
        if text.startswith("```"):
            # strip code fences
            nl = text.find("\n")
            if nl != -1:
                text = text[nl + 1:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            return None
        try:
            return FillPlanLLMOutput.model_validate(obj)
        except PydanticValidationError:
            return None

    @staticmethod
    def _ensure_field_coverage(plan: FillPlanLLMOutput, field_ids: list[str]) -> FillPlanLLMOutput:
        """Make every scanned field either filled or explicitly pending user input."""
        covered = set(plan.filled) | set(plan.needs_user_input)
        missing = [field_id for field_id in field_ids if field_id not in covered]
        if missing:
            plan.needs_user_input = [*plan.needs_user_input, *missing]
            log.warning("fill_plan_missing_fields_marked_needs_input", missing_count=len(missing))
        return plan

    def _apply_thinking_mode(self, mode: str | None) -> str:
        if mode:
            setter = getattr(self.model, "set_thinking_mode", None)
            if callable(setter):
                setter(mode)
        return str(getattr(self.model, "thinking_mode", mode or "disabled"))

    @staticmethod
    def _structure_hash(
        form_fields: list[dict],
        overrides: dict[str, str],
        thinking_mode: str = "disabled",
    ) -> str:
        # Stable canonical JSON: ignore per-scan DOM ids so auto_xxx fieldIds
        # do not poison cache reuse. The original fieldId still goes to the
        # model and response; it is only excluded from structural identity.
        normalized_fields = [_canonical_field_for_hash(field) for field in form_fields]
        canonical = {
            "fields": sorted(
                normalized_fields,
                key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False),
            ),
            "overrides": dict(sorted(overrides.items())),
            "thinking_mode": thinking_mode,
        }
        payload = json.dumps(canonical, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _canonical_field_for_hash(field: dict) -> dict:
    """Return the structural identity of one scanned field for cache hashing."""
    volatile_keys = {"fieldId", "id", "frameUrl", "frameIndex", "currentValue"}
    out: dict = {}
    for key, value in field.items():
        if key in volatile_keys:
            continue
        if key == "subFields" and isinstance(value, list):
            out[key] = [_canonical_field_for_hash(child) for child in value]
        else:
            out[key] = value
    return out


def _extract_domain(url: str) -> str:
    try:
        return urlparse(url).hostname or "unknown"
    except Exception:
        return "unknown"


# Lightweight protocol for type hint (kept as module-level alias)
class ModelResponseLike:
    model_id: str
    input_tokens: int
    output_tokens: int
    cost_cny: Decimal
    latency_ms: int
