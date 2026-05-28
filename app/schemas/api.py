"""API request/response wrappers (excluding fill_plan, which has its own module)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.resume import ResumeData


ParseStatus = Literal["pending", "processing", "completed", "failed"]


class RegisterUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=256)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class RegisterUserResponse(BaseModel):
    user_id: str
    username: str
    token: str
    is_admin: bool = False


class LoginResponse(BaseModel):
    user_id: str
    username: str
    token: str
    is_admin: bool


class CurrentUserResponse(BaseModel):
    user_id: str
    username: str
    is_admin: bool
    plan_tier: str


class AdminBootstrapStatus(BaseModel):
    needs_bootstrap: bool


class ResumeUploadResponse(BaseModel):
    resume_id: str
    status: ParseStatus
    message: str = ""


class ParseStatusResponse(BaseModel):
    resume_id: str
    status: ParseStatus
    error: str | None = None
    parse_completed_at: datetime | None = None


class ResumeDetailResponse(BaseModel):
    resume_id: str
    status: ParseStatus
    schema_version: str
    parsed_data_version: int
    data: ResumeData | None = None
    error: str | None = None


class ResumePatch(BaseModel):
    """Partial update to parsed_data. The server deep-merges into existing JSON."""

    patch: dict[str, Any]


class ResumeMetaResponse(BaseModel):
    resume_id: str
    original_filename: str
    file_format: str
    status: ParseStatus
    parsed_data_version: int
    created_at: datetime
    updated_at: datetime


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None
