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
from typing import Any
from urllib.parse import urlparse

from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.models.base import ChatModel
from app.core.config import get_settings
from app.core.exceptions import BusinessError, NotFoundError
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
    FilledField,
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
            log.warning(
                "fill_model_invalid_using_rules_fallback",
                model=response2.model_id,
                field_count=len(form_fields),
            )
            fallback = _build_rules_fallback_plan(resume_data, form_fields)
            merged = ModelResponse(
                content=fallback.model_dump_json(),
                model_id=f"{response2.model_id}+rules-fallback",
                input_tokens=response.input_tokens + response2.input_tokens,
                output_tokens=response.output_tokens + response2.output_tokens,
                cost_cny=response.cost_cny + response2.cost_cny,
                latency_ms=response.latency_ms + response2.latency_ms,
            )
            return fallback, merged
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


def _build_rules_fallback_plan(resume_data: dict, form_fields: list[dict]) -> FillPlanLLMOutput:
    """Conservative deterministic mapping when the model returns invalid JSON/schema."""
    filled: dict[str, FilledField] = {}
    needs_user_input: list[str] = []

    for field in _iter_fields(form_fields):
        field_id = str(field.get("fieldId") or field.get("id") or "").strip()
        if not field_id:
            continue
        match = _match_field_from_resume(field, resume_data)
        if match is None:
            needs_user_input.append(field_id)
            continue
        value, source, confidence = match
        filled[field_id] = FilledField(
            value=value,
            confidence=confidence,
            reasoning="模型输出未通过校验，使用后端规则兜底匹配",
            source=source,
        )

    return FillPlanLLMOutput(
        filled=filled,
        needs_user_input=list(dict.fromkeys(needs_user_input)),
        warnings=["模型输出校验失败，已使用规则匹配兜底"],
    )


def _iter_fields(fields: list[dict]) -> list[dict]:
    out: list[dict] = []
    for field in fields:
        out.append(field)
        children = field.get("subFields") or field.get("sub_fields") or []
        if isinstance(children, list):
            out.extend(_iter_fields([child for child in children if isinstance(child, dict)]))
    return out


def _match_field_from_resume(
    field: dict[str, Any],
    resume_data: dict[str, Any],
) -> tuple[Any, str, float] | None:
    field_type = str(field.get("type") or "").casefold()
    text = _field_search_text(field)
    label = str(field.get("label") or "").strip()

    if field.get("disabled") or field.get("readonly"):
        return None
    if field_type == "file" or _contains_any(text, ("附件", "上传", "简历文件", "resume file", "upload")):
        return None

    basic = _dict(resume_data.get("basic_info"))
    intent = _dict(resume_data.get("job_intent"))
    education = _first_dict(resume_data.get("education"))
    work = _first_dict(resume_data.get("work_experience"))
    internship = _first_dict(resume_data.get("internship_experience"))

    if _contains_any(text, ("自我评价", "个人评价", "自我介绍", "intro", "summary", "profile")):
        value = resume_data.get("self_evaluation")
        value_text = _as_text(value)
        if not value_text:
            return None
        return _filled(value_text, "self_evaluation", 0.8)

    gender = _as_text(basic.get("gender"))
    if _contains_any(text, ("性别", "gender")):
        if _looks_like_option_label(label, {"男", "女", "male", "female"}):
            if not _option_label_matches(label, gender):
                return None
        value = _coerce_option_value(field, gender)
        return _filled(value, "basic_info.gender", 0.86)

    skill_values = _skill_values(resume_data.get("skills"))
    if _contains_any(text, ("技能", "skill", "技术栈", "tech stack")):
        if field_type == "checkbox" and label:
            matched = _match_one_from_list(label, skill_values)
            if matched is None:
                return None
            return _filled(_coerce_option_value(field, matched), "skills", 0.82)
        if skill_values:
            return _filled("、".join(skill_values), "skills", 0.74)

    rules: list[tuple[tuple[str, ...], Any, str, float]] = [
        (("姓名", "真实姓名", "full name", "name"), basic.get("name"), "basic_info.name", 0.9),
        (("邮箱", "电子邮箱", "email", "e-mail"), basic.get("email"), "basic_info.email", 0.9),
        (("手机号", "手机", "电话", "phone", "mobile", "tel"), basic.get("phone"), "basic_info.phone", 0.9),
        (("出生", "生日", "birth", "birthday"), basic.get("birth_date"), "basic_info.birth_date", 0.86),
        (("年龄", "age"), basic.get("age"), "basic_info.age", 0.78),
        (("现居", "所在地", "当前城市", "居住地", "location", "city"), basic.get("location"), "basic_info.location", 0.72),
        (("籍贯", "hometown"), basic.get("hometown"), "basic_info.hometown", 0.78),
        (("婚姻", "marital"), basic.get("marital_status"), "basic_info.marital_status", 0.78),
        (("政治", "political"), basic.get("political_status"), "basic_info.political_status", 0.78),
        (("民族", "ethnicity"), basic.get("ethnicity"), "basic_info.ethnicity", 0.78),
        (("目标岗位", "期望岗位", "应聘岗位", "职位", "position", "job title"), intent.get("target_position"), "job_intent.target_position", 0.76),
        (("期望薪资", "薪资", "salary"), intent.get("expected_salary"), "job_intent.expected_salary", 0.76),
        (("到岗", "入职", "available"), intent.get("available_date"), "job_intent.available_date", 0.76),
        (("期望城市", "意向城市", "工作地点"), intent.get("work_location_preference"), "job_intent.work_location_preference", 0.74),
        (("学校", "院校", "school", "university"), education.get("school"), "education[0].school", 0.84),
        (("学历", "学位", "degree"), education.get("degree"), "education[0].degree", 0.82),
        (("专业", "major"), education.get("major"), "education[0].major", 0.82),
        (("公司", "单位", "company"), work.get("company") or internship.get("company"), "work_experience[0].company", 0.68),
        (("部门", "department"), work.get("department") or internship.get("department"), "work_experience[0].department", 0.66),
        (("github", "git hub"), _fact_value(resume_data, "github"), "facts.github_profile", 0.76),
    ]

    for terms, value, source, confidence in rules:
        if _contains_any(text, terms):
            value_text = _as_text(value)
            if not value_text:
                return None
            return _filled(_coerce_option_value(field, value_text), source, confidence)

    return None


def _filled(value: Any, source: str, confidence: float) -> tuple[Any, str, float] | None:
    value_text = _as_text(value)
    if not value_text:
        return None
    return value, source, confidence


def _field_search_text(field: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in (
        "fieldId", "id", "label", "placeholder", "name", "ariaLabel",
        "autocomplete", "section", "subLabel", "htmlType", "type",
    ):
        value = field.get(key)
        if value:
            parts.append(str(value))
    section_path = field.get("sectionPath") or field.get("section_path")
    if isinstance(section_path, list):
        parts.extend(str(part) for part in section_path if part)
    return " ".join(parts).casefold()


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term.casefold() in text for term in terms)


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                return item
    return {}


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    if isinstance(value, list):
        return "、".join(item for item in (_as_text(v) for v in value) if item)
    if isinstance(value, dict):
        return "、".join(item for item in (_as_text(v) for v in value.values()) if item)
    return str(value).strip()


def _skill_values(value: Any) -> list[str]:
    skills = _dict(value)
    out: list[str] = []
    for item in skills.values():
        if isinstance(item, list):
            out.extend(_as_text(v) for v in item)
        else:
            out.append(_as_text(item))
    return [item for item in dict.fromkeys(out) if item]


def _match_one_from_list(label: str, values: list[str]) -> str | None:
    normalized_label = label.casefold().strip()
    for value in values:
        normalized_value = value.casefold().strip()
        if normalized_label == normalized_value or normalized_value in normalized_label:
            return value
    return None


def _looks_like_option_label(label: str, options: set[str]) -> bool:
    normalized = label.casefold().strip()
    return normalized in {item.casefold() for item in options}


def _option_label_matches(label: str, value: str) -> bool:
    label_norm = label.casefold().strip()
    value_norm = value.casefold().strip()
    if not label_norm or not value_norm:
        return False
    if label_norm == value_norm:
        return True
    return (
        (value == "男" and label_norm in {"male", "男"})
        or (value == "女" and label_norm in {"female", "女"})
    )


def _coerce_option_value(field: dict[str, Any], value: Any) -> Any:
    value_text = _as_text(value)
    if not value_text:
        return value
    option_sources = []
    options = field.get("optionObjects") or field.get("option_objects") or []
    if isinstance(options, list):
        option_sources.extend(options)
    raw_options = field.get("options") or []
    if isinstance(raw_options, list):
        option_sources.extend(raw_options)

    for option in option_sources:
        if isinstance(option, dict):
            label = _as_text(option.get("label"))
            option_value = _as_text(option.get("value")) or label
        else:
            label = _as_text(option)
            option_value = label
        haystacks = {label.casefold(), option_value.casefold()}
        if value_text.casefold() in haystacks:
            return option_value
        if value_text == "男" and ({"男", "male"} & haystacks):
            return option_value
        if value_text == "女" and ({"女", "female"} & haystacks):
            return option_value
    return value


def _fact_value(resume_data: dict[str, Any], key: str) -> str:
    facts = resume_data.get("facts")
    if not isinstance(facts, list):
        return ""
    for fact in facts:
        if not isinstance(fact, dict):
            continue
        if str(fact.get("key") or "").casefold() == key.casefold():
            return _as_text(fact.get("normalized_value") or fact.get("value"))
    return ""


# Lightweight protocol for type hint (kept as module-level alias)
class ModelResponseLike:
    model_id: str
    input_tokens: int
    output_tokens: int
    cost_cny: Decimal
    latency_ms: int
