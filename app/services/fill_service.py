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
import re
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
        form_fields_dump = _augment_fields_with_repeat_context(
            [f.model_dump(mode="json", exclude_none=True) for f in request.fields]
        )
        structure_hash = self._structure_hash(
            form_fields_dump,
            request.user_overrides,
            effective_thinking_mode,
        )

        cached = None
        if not request.forceRefresh:
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
            cached_plan = _apply_deterministic_field_repairs(
                FillPlanLLMOutput.model_validate(cached.plan_data),
                resume.parsed_data,
                form_fields_dump,
            )
            cached_plan = self._ensure_field_coverage(cached_plan, form_field_ids)
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
        plan = _apply_deterministic_field_repairs(plan, resume.parsed_data, form_fields_dump)
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

    for field in _iter_fields(_augment_fields_with_repeat_context(form_fields)):
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


def _apply_deterministic_field_repairs(
    plan: FillPlanLLMOutput,
    resume_data: dict,
    form_fields: list[dict],
) -> FillPlanLLMOutput:
    """Correct high-confidence structured fields even when the model response is valid."""
    repaired = plan.model_copy(deep=True)
    for field in _iter_fields(_augment_fields_with_repeat_context(form_fields)):
        field_id = str(field.get("fieldId") or field.get("id") or "").strip()
        if not field_id or not _should_repair_phone_field(field):
            continue
        match = _match_field_from_resume(field, resume_data)
        if match is None:
            continue
        value, source, confidence = match
        repaired.filled[field_id] = FilledField(
            value=value,
            confidence=confidence,
            reasoning="后端规则校正复合手机号字段",
            source=source,
        )
        repaired.needs_user_input = [
            existing for existing in repaired.needs_user_input if existing != field_id
        ]
    return repaired


def _should_repair_phone_field(field: dict[str, Any]) -> bool:
    text = _field_search_text(field)
    if not _contains_any(text, ("手机号", "手机号码", "手机", "电话", "联系方式", "phone", "mobile", "tel")):
        return False
    group_value = field.get("groupSize")
    if group_value is None:
        group_value = field.get("group_size")
    group_size = _safe_int(group_value)
    return (group_size is not None and group_size > 1) or _phone_country_code_field(field, text)


def _augment_fields_with_repeat_context(form_fields: list[dict]) -> list[dict]:
    """Infer repeat metadata from flat, repeated field signatures.

    The extension normally emits repeatIndex/repeatSection after dynamic cards
    are expanded. This backend pass is a conservative safety net for older or
    partially-scanned ATS pages where the DOM has repeated cards but no explicit
    repeat metadata.
    """
    fields = [_copy_field_tree(field) for field in form_fields]
    _infer_contiguous_repeat_runs(fields)
    return fields


def _copy_field_tree(field: dict) -> dict:
    copied = dict(field)
    children = copied.get("subFields") or copied.get("sub_fields")
    if isinstance(children, list):
        copied["subFields"] = [
            _copy_field_tree(child)
            for child in children
            if isinstance(child, dict)
        ]
        _infer_contiguous_repeat_runs(copied["subFields"])
        copied.pop("sub_fields", None)
    return copied


def _infer_contiguous_repeat_runs(fields: list[dict]) -> None:
    max_width = 12
    i = 0
    while i < len(fields):
        matched = False
        remaining = len(fields) - i
        for width in range(2, min(max_width, remaining // 2) + 1):
            signature = [_repeat_signature_part(fields[i + offset]) for offset in range(width)]
            if not all(signature):
                continue
            section_name = _infer_repeat_section_from_signature(signature)
            if not section_name:
                continue

            count = 1
            while i + (count + 1) * width <= len(fields):
                next_sig = [
                    _repeat_signature_part(fields[i + count * width + offset])
                    for offset in range(width)
                ]
                if next_sig != signature:
                    break
                count += 1

            if count < 2:
                continue

            _apply_inferred_repeat(fields, i, width, count, section_name)
            i += width * count
            matched = True
            break

        if not matched:
            i += 1


def _repeat_signature_part(field: dict[str, Any]) -> str:
    label = _as_text(field.get("label"))
    sub_label = _as_text(field.get("subLabel") or field.get("sub_label"))
    placeholder = _as_text(field.get("placeholder"))
    text = label or sub_label or placeholder
    if not text:
        return ""
    group_index = field.get("groupIndex")
    if group_index is None:
        group_index = field.get("group_index")
    group_part = f"#{group_index}" if group_index is not None else ""
    return f"{text.casefold().strip()}{group_part}"


def _infer_repeat_section_from_signature(signature: list[str]) -> str | None:
    if len(set(signature)) < 2:
        return None
    return _repeat_section_name_from_text(" ".join(signature))


def _repeat_section_name_from_text(text: str) -> str | None:
    normalized = text.casefold()
    if "项目" in normalized or "project" in normalized:
        return "项目经历"
    if "实习" in normalized or "intern" in normalized:
        return "实习经历"
    if (
        "教育" in normalized or "学历" in normalized or "学位" in normalized or
        "学校" in normalized or "院校" in normalized or "专业" in normalized or
        "院系" in normalized or "求学" in normalized or
        "education" in normalized or "school" in normalized or
        "university" in normalized or "degree" in normalized or "major" in normalized
    ):
        return "教育经历"
    if "校园" in normalized or "社团" in normalized or "学生干部" in normalized or "社会实践" in normalized or "实践经历" in normalized or "campus" in normalized:
        return "校园经历"
    if (
        "工作经历" in normalized or "工作经验" in normalized or "工作履历" in normalized or
        "任职经历" in normalized or "职业经历" in normalized or "就业经历" in normalized or
        "公司" in normalized or "职位" in normalized or "岗位" in normalized or
        "work experience" in normalized or "work history" in normalized or
        "employment history" in normalized or "professional experience" in normalized or
        "career history" in normalized or "company" in normalized or "position" in normalized
    ):
        return "工作经历"
    return None


def _apply_inferred_repeat(
    fields: list[dict],
    start: int,
    width: int,
    count: int,
    section_name: str,
) -> None:
    repeat_group_id = f"seq_{start}_{width}_{count}"
    for repeat_index in range(count):
        offset = start + repeat_index * width
        for pos in range(width):
            field = fields[offset + pos]
            changed = False
            if field.get("repeatGroupId") is None and field.get("repeat_group_id") is None:
                field["repeatGroupId"] = repeat_group_id
                changed = True
            if field.get("repeatIndex") is None and field.get("repeat_index") is None:
                field["repeatIndex"] = repeat_index
                changed = True
            if field.get("repeatSize") is None and field.get("repeat_size") is None:
                field["repeatSize"] = count
                changed = True
            if field.get("repeatSection") is None and field.get("repeat_section") is None:
                field["repeatSection"] = section_name
                changed = True
            if changed:
                field.pop("fieldFingerprint", None)
                field.pop("field_fingerprint", None)


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

    if _truthy_meta(field.get("disabled")):
        return None
    if _is_plain_readonly_field(field):
        return None
    if field_type == "file" or _contains_any(text, ("附件", "上传", "简历文件", "resume file", "upload")):
        return None

    repeated_match = _match_repeated_item_field(field, resume_data)
    if repeated_match is not None:
        return repeated_match

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

    phone_match = _match_phone_field(field, basic, text)
    if phone_match is not None:
        return phone_match

    rules: list[tuple[tuple[str, ...], Any, str, float]] = [
        (("姓名", "真实姓名", "full name", "name"), basic.get("name"), "basic_info.name", 0.9),
        (("邮箱", "电子邮箱", "email", "e-mail"), basic.get("email"), "basic_info.email", 0.9),
        (("手机号", "手机", "电话", "phone", "mobile", "tel"), basic.get("phone"), "basic_info.phone", 0.9),
        (("出生", "生日", "birth", "birthday"), basic.get("birth_date"), "basic_info.birth_date", 0.86),
        (("年龄", "age"), basic.get("age"), "basic_info.age", 0.78),
        (("期望城市", "意向城市", "工作地点", "工作城市", "location preference"), intent.get("work_location_preference"), "job_intent.work_location_preference", 0.74),
        (("现居", "所在地", "当前城市", "居住地", "location", "city"), basic.get("location"), "basic_info.location", 0.72),
        (("籍贯", "hometown"), basic.get("hometown"), "basic_info.hometown", 0.78),
        (("婚姻", "marital"), basic.get("marital_status"), "basic_info.marital_status", 0.78),
        (("政治", "political"), basic.get("political_status"), "basic_info.political_status", 0.78),
        (("民族", "ethnicity"), basic.get("ethnicity"), "basic_info.ethnicity", 0.78),
        (("目标岗位", "期望岗位", "应聘岗位", "职位", "position", "job title"), intent.get("target_position"), "job_intent.target_position", 0.76),
        (("期望薪资", "薪资", "salary"), intent.get("expected_salary"), "job_intent.expected_salary", 0.76),
        (("到岗", "入职", "available"), intent.get("available_date"), "job_intent.available_date", 0.76),
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
                continue
            return _filled(_coerce_option_value(field, value_text), source, confidence)

    return None


def _match_phone_field(
    field: dict[str, Any],
    basic: dict[str, Any],
    text: str,
) -> tuple[Any, str, float] | None:
    if not _contains_any(text, ("手机号", "手机号码", "手机", "电话", "联系方式", "phone", "mobile", "tel")):
        return None

    phone = _as_text(basic.get("phone"))
    if not phone:
        return None

    if _phone_country_code_field(field, text):
        code, source = _phone_country_code_value(basic, phone)
        if not code:
            return None
        return _filled(_coerce_option_value(field, code), source, 0.86)

    return _filled(_coerce_option_value(field, phone), "basic_info.phone", 0.9)


def _phone_country_code_field(field: dict[str, Any], text: str) -> bool:
    if _contains_any(
        text,
        (
            "区号", "国家码", "国家代码", "国家/地区", "国家及地区",
            "country code", "area code", "dial code", "country/region",
            "country region", "calling code",
        ),
    ):
        return True

    group_value = field.get("groupIndex")
    if group_value is None:
        group_value = field.get("group_index")
    group_index = _safe_int(group_value)
    if group_index == 0 and _options_look_like_phone_country_codes(field):
        return True

    field_type = str(field.get("type") or "").casefold()
    widget = str(field.get("widget") or "").casefold()
    return (
        field_type in {"select", "radio"}
        or "select" in widget
        or "dropdown" in widget
        or "combobox" in widget
    ) and _options_look_like_phone_country_codes(field)


def _phone_country_code_value(basic: dict[str, Any], phone: str) -> tuple[str, str]:
    for key in (
        "phone_country_code",
        "country_code",
        "area_code",
        "dial_code",
        "phone_country",
        "phone_region",
    ):
        value = _as_text(basic.get(key))
        if value:
            return value, f"basic_info.{key}"

    compact = phone.strip()
    digits = re.sub(r"\D+", "", compact)
    if compact.startswith("+") and len(digits) > 11:
        return f"+{digits[:-11]}", "basic_info.phone"
    if compact.startswith("00") and len(digits) > 13:
        return f"+{digits[2:-11]}", "basic_info.phone"
    if (len(digits) == 13 and digits.startswith("86")) or (len(digits) == 11 and digits.startswith("1")):
        return "+86", "basic_info.phone"
    return "", "basic_info.phone"


def _options_look_like_phone_country_codes(field: dict[str, Any]) -> bool:
    for option_text in _option_texts(field):
        normalized = option_text.casefold()
        if re.search(r"(?<!\d)(?:\+|00)\d{1,4}(?!\d)", option_text):
            return True
        if _contains_any(normalized, ("中国", "china", "mainland", "香港", "澳门", "台湾")):
            return True
    return False


def _is_plain_readonly_field(field: dict[str, Any]) -> bool:
    if not _truthy_meta(field.get("readonly") or field.get("readOnly")):
        return False

    field_type = str(field.get("type") or "").casefold()
    widget = str(field.get("widget") or "").casefold()
    html_type = str(field.get("htmlType") or field.get("html_type") or "").casefold()

    interactive_widgets = {
        "native-select",
        "aria-combobox",
        "custom-dropdown",
        "search-select",
        "cascader",
        "pseudo-radio",
        "date-picker",
        "date-range",
        "radio-group",
        "checkbox-group",
        "file-upload",
    }
    if widget == "custom-dropdown" and _readonly_metadata_suggests_plain_text(field):
        return True
    if widget in interactive_widgets:
        return False
    if field_type in {"select", "date", "radio", "checkbox", "file"}:
        return False

    plain_types = {"text", "tel", "email", "number", "url", "textarea"}
    plain_widgets = {"text-input", "textarea", "contenteditable"}
    plain_html_types = {"text", "email", "tel", "number", "url", "search", "password", "textarea"}

    if widget in plain_widgets:
        return True
    if field_type in plain_types:
        return True
    if html_type in plain_html_types:
        return True
    return True


def _readonly_metadata_suggests_plain_text(field: dict[str, Any]) -> bool:
    html_type = str(field.get("htmlType") or field.get("html_type") or "").casefold()
    if html_type in {"email", "tel", "number", "url", "password"}:
        return True

    text = " ".join(
        str(field.get(key) or "")
        for key in ("label", "placeholder", "name", "ariaLabel", "aria_label", "autocomplete")
    ).casefold()
    return _contains_any(
        text,
        (
            "姓名", "名字", "邮箱", "邮件", "手机号", "手机号码", "电话", "联系方式",
            "号码", "证件号", "身份证", "护照号", "账号", "账户",
            "name", "email", "e-mail", "phone", "mobile", "tel", "number", "account",
        ),
    )


def _truthy_meta(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().casefold() in {"1", "true", "yes", "on", "readonly", "disabled"}
    return bool(value)


def _match_repeated_item_field(
    field: dict[str, Any],
    resume_data: dict[str, Any],
) -> tuple[Any, str, float] | None:
    section_key = _repeat_section_key(field)
    if not section_key:
        return None

    items = resume_data.get(section_key)
    if not isinstance(items, list) or not items:
        return None

    index = _safe_repeat_index(field)
    if index < 0 or index >= len(items):
        return None

    item = _dict(items[index])
    if not item:
        return None

    text = _field_search_text(field)
    item_key = _repeated_item_key_for_field(section_key, text, field)
    if item_key is None:
        return None

    if item_key == "current_flag":
        value = _present_flag_value(field, item)
        source_key = "end_date"
    else:
        value = _value_from_repeated_item(item, item_key)
        source_key = item_key
    if value is None:
        return None

    normalized_value = _as_text(value) if isinstance(value, (list, dict)) else value
    return _filled(
        _coerce_option_value(field, normalized_value),
        f"{section_key}[{index}].{source_key}",
        0.82,
    )


def _repeat_section_key(field: dict[str, Any]) -> str | None:
    has_repeat_marker = field.get("repeatIndex") is not None or field.get("repeat_index") is not None
    text = " ".join(
        str(value)
        for value in (
            field.get("repeatSection"),
            field.get("repeat_section"),
            field.get("section"),
            field.get("label"),
        )
        if value
    ).casefold()
    if not text:
        return None
    if "项目" in text or "project" in text:
        return "project_experience"
    if (
        "教育" in text or "学历" in text or "学位" in text or "学校" in text or
        "院校" in text or "专业" in text or "院系" in text or "求学" in text or
        "education" in text or "school" in text or "university" in text or
        "degree" in text or "major" in text
    ):
        return "education"
    if "实习" in text or "intern" in text:
        return "internship_experience"
    if (
        "工作经历" in text or "工作经验" in text or "工作履历" in text or
        "任职经历" in text or "职业经历" in text or "就业经历" in text or
        "work experience" in text or "work history" in text or
        "employment history" in text or "professional experience" in text or
        "career history" in text
    ):
        return "work_experience"
    if has_repeat_marker and ("公司" in text or "职位" in text or "岗位" in text or "company" in text or "position" in text):
        return "work_experience"
    if "校园" in text or "社团" in text or "学生干部" in text or "社会实践" in text or "实践经历" in text or "campus" in text:
        return "campus_experience"
    return None


def _safe_repeat_index(field: dict[str, Any]) -> int:
    value = field.get("repeatIndex")
    if value is None:
        value = field.get("repeat_index")
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return 0


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _repeated_item_key_for_field(
    section_key: str,
    text: str,
    field: dict[str, Any],
) -> str | None:
    if _present_flag_field(text, field):
        return "current_flag"

    range_key = _date_range_key(field, text)
    if range_key:
        return range_key

    if section_key == "project_experience":
        rules = [
            (("项目名称", "项目名", "project name", "name"), "name"),
            (("项目角色", "担任角色", "角色", "role"), "role"),
            (("开始", "起始", "start"), "start_date"),
            (("结束", "截止", "end"), "end_date"),
            (("技术", "工具", "环境", "tech", "stack"), "tech_stack"),
            (("描述", "简介", "介绍", "背景", "description"), "description"),
            (("成果", "业绩", "职责", "内容", "工作内容", "项目内容", "主要工作", "achievement"), "achievements"),
        ]
    elif section_key == "education":
        rules = [
            (("学校", "院校", "school", "university"), "school"),
            (("学历", "学位", "degree"), "degree"),
            (("专业", "major"), "major"),
            (("开始", "入学", "start"), "start_date"),
            (("结束", "毕业", "end"), "end_date"),
            (("gpa", "绩点"), "gpa"),
            (("排名", "rank"), "ranking"),
            (("荣誉", "奖励", "honor", "award"), "honors"),
            (("课程", "course"), "courses"),
        ]
    elif section_key in {"work_experience", "internship_experience"}:
        rules = [
            (("公司", "单位", "company"), "company"),
            (("部门", "department"), "department"),
            (("职位", "岗位", "职务", "title", "position"), "title"),
            (("开始", "入职", "start"), "start_date"),
            (("结束", "离职", "end"), "end_date"),
            (("技术", "工具", "环境", "tech", "stack"), "tech_stack"),
            (("成果", "业绩", "职责", "内容", "工作内容", "主要工作", "achievement"), "achievements"),
        ]
    elif section_key == "campus_experience":
        rules = [
            (("组织", "社团", "学校", "organization"), "organization"),
            (("部门", "department"), "department"),
            (("角色", "职务", "职位", "role", "position"), "role"),
            (("类别", "类型", "category"), "category"),
            (("开始", "start"), "start_date"),
            (("结束", "end"), "end_date"),
            (("成果", "职责", "内容", "achievement"), "achievements"),
            (("标签", "tag"), "tags"),
        ]
    else:
        return None

    for terms, key in rules:
        if _contains_any(text, terms):
            return key
    return None


def _present_flag_field(text: str, field: dict[str, Any]) -> bool:
    field_type = str(field.get("type") or "").casefold()
    if field_type not in {"checkbox", "radio", "select"}:
        return False
    return _contains_any(text, ("至今", "目前", "现在", "当前", "present", "current", "now", "ongoing"))


def _date_range_key(field: dict[str, Any], text: str) -> str | None:
    if not _contains_any(text, ("起止", "时间", "日期", "年月", "period", "date", "time")):
        return None
    widget = str(field.get("widget") or "").casefold()
    field_type = str(field.get("type") or "").casefold()
    group_index = field.get("groupIndex")
    if group_index is None:
        group_index = field.get("group_index")
    try:
        parsed = int(group_index)
    except (TypeError, ValueError):
        parsed = -1
    if parsed == 0:
        return "start_date"
    if parsed == 1:
        return "end_date"
    if widget == "date-range" or (field_type == "date" and _contains_any(text, ("起止", "range", "period"))):
        return "date_range"
    return None


def _present_flag_value(field: dict[str, Any], item: dict[str, Any]) -> str | None:
    end_text = _as_text(item.get("end_date")).casefold()
    is_current = not end_text or _contains_any(
        end_text,
        ("至今", "目前", "现在", "当前", "present", "current", "now", "ongoing"),
    )
    if not is_current:
        return None

    for option in field.get("options") or []:
        option_text = _as_text(option.get("label") if isinstance(option, dict) else option)
        if option_text and _present_flag_label(option_text):
            return option_text

    label = _as_text(field.get("label"))
    if label and _present_flag_label(label):
        return label
    return "至今"


def _present_flag_label(text: str) -> bool:
    return _contains_any(
        text.casefold(),
        ("至今", "目前", "现在", "当前", "present", "current", "now", "ongoing"),
    )


def _value_from_repeated_item(item: dict[str, Any], key: str) -> Any:
    value = item.get(key)
    if key == "ranking" and isinstance(value, dict):
        return value.get("raw") or value.get("rank")
    if value:
        return value
    if key == "description":
        return _as_text(item.get("achievements"))
    if key == "achievements":
        return item.get("description") or item.get("achievements")
    if key == "date_range":
        return _date_range_value(item)
    return None


def _date_range_value(item: dict[str, Any]) -> str | None:
    start = _as_text(item.get("start_date"))
    end = _as_text(item.get("end_date"))
    if not start and not end:
        return None
    if not end:
        end = "至今"
    if not start:
        return end
    return f"{start} - {end}"


def _filled(value: Any, source: str, confidence: float) -> tuple[Any, str, float] | None:
    value_text = _as_text(value)
    if not value_text:
        return None
    return value, source, confidence


def _field_search_text(field: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in (
        "fieldId", "id", "label", "placeholder", "name", "ariaLabel",
        "autocomplete", "section", "repeatSection", "subLabel", "htmlType", "type",
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
    for option in _option_sources(field):
        if isinstance(option, dict):
            label = _as_text(option.get("label"))
            option_value = _as_text(option.get("value")) or label
        else:
            label = _as_text(option)
            option_value = label
        haystacks = {label.casefold(), option_value.casefold()}
        if value_text.casefold() in haystacks:
            return option_value
        if _option_contains_phone_country_code(label, option_value, value_text):
            return option_value
        if value_text == "男" and ({"男", "male"} & haystacks):
            return option_value
        if value_text == "女" and ({"女", "female"} & haystacks):
            return option_value
    return value


def _option_sources(field: dict[str, Any]) -> list[Any]:
    option_sources: list[Any] = []
    options = field.get("optionObjects") or field.get("option_objects") or []
    if isinstance(options, list):
        option_sources.extend(options)
    raw_options = field.get("options") or []
    if isinstance(raw_options, list):
        option_sources.extend(raw_options)
    return option_sources


def _option_texts(field: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for option in _option_sources(field):
        if isinstance(option, dict):
            texts.append(
                " ".join(
                    part
                    for part in (_as_text(option.get("label")), _as_text(option.get("value")))
                    if part
                )
            )
        else:
            texts.append(_as_text(option))
    return [text for text in texts if text]


def _option_contains_phone_country_code(label: str, option_value: str, value_text: str) -> bool:
    normalized_value = value_text.casefold().strip()
    candidates = [label.casefold(), option_value.casefold()]
    if normalized_value in {"中国", "中国大陆", "china", "mainland china"}:
        return any(normalized_value in candidate for candidate in candidates)

    digits = re.sub(r"\D+", "", value_text)
    if not digits or len(digits) > 4:
        return False
    for candidate in candidates:
        if re.search(rf"(?<!\d)(?:\+|00)?{re.escape(digits)}(?!\d)", candidate):
            return True
    return False


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
