"""Fill plan route — Stage B endpoint consumed by the browser extension."""
from __future__ import annotations

from typing import Any
import uuid

from fastapi import APIRouter

from app.api.deps import CurrentUser, FillSvc
from app.schemas.fill_plan import (
    FillPlanRequest,
    FillPlanResponse,
    PluginMatchResponse,
    PluginScanResponse,
    SectionAction,
)


router = APIRouter(prefix="/fill-plans", tags=["fill-plans"])


@router.post("", response_model=FillPlanResponse)
async def create_fill_plan(
    payload: FillPlanRequest,
    user: CurrentUser,
    svc: FillSvc,
) -> FillPlanResponse:
    return await svc.create_plan(user.id, payload)


@router.post("/plugin-match", response_model=PluginMatchResponse)
async def create_plugin_match(
    payload: FillPlanRequest,
    user: CurrentUser,
    svc: FillSvc,
) -> PluginMatchResponse:
    """Return a fill plan plus the simple mapping shape used by the extension."""
    plan = await svc.create_plan(user.id, payload)
    section_actions: dict[str, str] = {}
    section_action_details: list[SectionAction] = []
    if payload.resumeId:
        resume = await svc.resume_repo.get(payload.resumeId)
        if resume and resume.user_id == user.id and resume.parsed_data:
            section_action_details = _build_section_action_details(payload.sections or [], resume.parsed_data)
            section_actions = _section_actions_from_details(section_action_details)
    return PluginMatchResponse.from_fill_plan(
        plan,
        fields=payload.fields,
        resume_id=payload.resumeId,
        section_actions=section_actions,
        section_action_details=section_action_details,
    )


@router.post("/plugin-scan", response_model=PluginScanResponse)
async def receive_plugin_scan(
    payload: FillPlanRequest,
    user: CurrentUser,
) -> PluginScanResponse:
    """Validate a scan payload from the extension without invoking the model."""
    warnings: list[str] = []
    actual_count = len(payload.fields)
    if payload.fieldCount is not None and payload.fieldCount != actual_count:
        warnings.append(
            f"fieldCount={payload.fieldCount} does not match fields length={actual_count}"
        )
    empty_labels = sum(1 for field in payload.fields if not field.label.strip())
    if empty_labels:
        warnings.append(f"{empty_labels} fields have empty labels")

    scan_id = payload.id or uuid.uuid4().hex
    return PluginScanResponse(
        id=scan_id,
        path=None,
        fieldCount=actual_count,
        warnings=warnings,
    )


def _build_section_actions(sections: list[dict[str, Any]], resume_data: dict[str, Any]) -> dict[str, str]:
    """Suggest dynamic form expansions for repeated resume sections."""
    return _section_actions_from_details(_build_section_action_details(sections, resume_data))


def _build_section_action_details(sections: list[dict[str, Any]], resume_data: dict[str, Any]) -> list[SectionAction]:
    """Suggest typed dynamic form expansions for repeated resume sections."""
    actions: list[SectionAction] = []
    if not sections:
        return actions

    target_counts = {
        "project_experience": _list_len(resume_data.get("project_experience")),
        "education": _list_len(resume_data.get("education")),
        "internship_experience": _list_len(resume_data.get("internship_experience")),
        "work_experience": _list_len(resume_data.get("work_experience")),
        "campus_experience": _list_len(resume_data.get("campus_experience")),
    }

    for section in sections:
        name = str(section.get("name") or "").strip()
        if not name or not section.get("addButton"):
            continue
        key = _section_key(name)
        if not key:
            continue
        target_count = target_counts.get(key, 0)
        if target_count <= 1:
            continue
        current_count = _safe_positive_int(section.get("currentCount"), default=1)
        add_count = target_count - current_count
        if add_count > 0:
            actions.append(SectionAction(
                sectionName=name,
                sectionKey=key,
                currentCount=current_count,
                targetCount=target_count,
                addCount=add_count,
                legacyAction=f"add_{add_count}",
            ))
    return actions


def _section_actions_from_details(details: list[SectionAction]) -> dict[str, str]:
    return {detail.sectionName: detail.legacyAction for detail in details}


def _list_len(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def _safe_positive_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(parsed, 0)


def _section_key(name: str) -> str | None:
    text = name.replace("-", " ").replace("_", " ").casefold()
    if "项目" in text or "project" in text:
        return "project_experience"
    if (
        "教育" in text or "学历" in text or "院校" in text or "求学" in text or
        "education" in text or "school" in text
    ):
        return "education"
    if "实习" in text or "intern" in text or "internship" in text:
        return "internship_experience"
    if (
        "工作经历" in text or "工作经验" in text or "工作履历" in text or
        "任职经历" in text or "职业经历" in text or "就业经历" in text or
        "work experience" in text or "work history" in text or
        "employment history" in text or "professional experience" in text or
        "career history" in text
    ):
        return "work_experience"
    if "校园" in text or "社团" in text or "学生干部" in text or "社会实践" in text or "实践经历" in text or "campus" in text:
        return "campus_experience"
    return None
