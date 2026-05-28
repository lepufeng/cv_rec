"""Resume routes: upload, get, patch, delete."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile, status

from app.api.deps import CurrentUser, ResumeSvc
from app.schemas.api import (
    ParseStatusResponse,
    ResumeDetailResponse,
    ResumePatch,
    ResumeUploadResponse,
)
from app.schemas.resume import ResumeData


router = APIRouter(prefix="/resumes", tags=["resumes"])


@router.get("", response_model=list[ResumeDetailResponse])
async def list_resumes(user: CurrentUser, svc: ResumeSvc) -> list[ResumeDetailResponse]:
    rows = await svc.list_for_user(user.id)
    return [
        ResumeDetailResponse(
            resume_id=r.id,
            status=r.parse_status,  # type: ignore[arg-type]
            schema_version=r.schema_version,
            parsed_data_version=r.parsed_data_version,
            data=ResumeData.model_validate(r.parsed_data) if r.parsed_data else None,
            error=r.parse_error,
        )
        for r in rows
    ]


@router.post(
    "",
    response_model=ResumeDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_resume(
    user: CurrentUser,
    svc: ResumeSvc,
    file: UploadFile = File(...),
    thinking_mode: str | None = Form(default=None),
) -> ResumeDetailResponse:
    """Upload a resume. Parses synchronously and returns the structured data."""
    content = await file.read()
    resume = await svc.upload_and_parse(
        user_id=user.id,
        filename=file.filename or "resume",
        content=content,
        thinking_mode=thinking_mode,
    )
    return ResumeDetailResponse(
        resume_id=resume.id,
        status=resume.parse_status,  # type: ignore[arg-type]
        schema_version=resume.schema_version,
        parsed_data_version=resume.parsed_data_version,
        data=ResumeData.model_validate(resume.parsed_data) if resume.parsed_data else None,
        error=resume.parse_error,
    )


@router.get("/{resume_id}/status", response_model=ParseStatusResponse)
async def get_status(
    resume_id: str,
    user: CurrentUser,
    svc: ResumeSvc,
) -> ParseStatusResponse:
    resume = await svc.get(user.id, resume_id)
    return ParseStatusResponse(
        resume_id=resume.id,
        status=resume.parse_status,  # type: ignore[arg-type]
        error=resume.parse_error,
        parse_completed_at=resume.parse_completed_at,
    )


@router.get("/{resume_id}", response_model=ResumeDetailResponse)
async def get_resume(
    resume_id: str,
    user: CurrentUser,
    svc: ResumeSvc,
    thinking_mode: str | None = Form(default=None),
) -> ResumeDetailResponse:
    resume = await svc.get(user.id, resume_id)
    return ResumeDetailResponse(
        resume_id=resume.id,
        status=resume.parse_status,  # type: ignore[arg-type]
        schema_version=resume.schema_version,
        parsed_data_version=resume.parsed_data_version,
        data=ResumeData.model_validate(resume.parsed_data) if resume.parsed_data else None,
        error=resume.parse_error,
    )


@router.patch("/{resume_id}", response_model=ResumeDetailResponse)
async def patch_resume(
    resume_id: str,
    payload: ResumePatch,
    user: CurrentUser,
    svc: ResumeSvc,
) -> ResumeDetailResponse:
    resume = await svc.patch(user.id, resume_id, payload.patch)
    return ResumeDetailResponse(
        resume_id=resume.id,
        status=resume.parse_status,  # type: ignore[arg-type]
        schema_version=resume.schema_version,
        parsed_data_version=resume.parsed_data_version,
        data=ResumeData.model_validate(resume.parsed_data) if resume.parsed_data else None,
        error=resume.parse_error,
    )


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resume(
    resume_id: str,
    user: CurrentUser,
    svc: ResumeSvc,
) -> None:
    await svc.delete(user.id, resume_id)


@router.post("/{resume_id}/reparse", response_model=ResumeDetailResponse)
async def reparse_resume(
    resume_id: str,
    user: CurrentUser,
    svc: ResumeSvc,
) -> ResumeDetailResponse:
    """Re-run parsing on a previously uploaded file."""
    resume = await svc.reparse(user.id, resume_id, thinking_mode=thinking_mode)
    return ResumeDetailResponse(
        resume_id=resume.id,
        status=resume.parse_status,  # type: ignore[arg-type]
        schema_version=resume.schema_version,
        parsed_data_version=resume.parsed_data_version,
        data=ResumeData.model_validate(resume.parsed_data) if resume.parsed_data else None,
        error=resume.parse_error,
    )
