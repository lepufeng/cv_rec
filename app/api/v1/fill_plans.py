"""Fill plan route — Stage B endpoint consumed by the browser extension."""
from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.api.deps import CurrentUser, FillSvc
from app.schemas.fill_plan import (
    FillPlanRequest,
    FillPlanResponse,
    PluginMatchResponse,
    PluginScanResponse,
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
    return PluginMatchResponse.from_fill_plan(plan)


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
