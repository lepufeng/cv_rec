"""Resume management: upload + sync parse, get, patch, delete."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from structlog.contextvars import bind_contextvars

from app.adapters.storage.base import StorageBackend
from app.core.config import get_settings
from app.core.exceptions import (
    BusinessError,
    ConfigError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from app.core.logging import get_logger
from app.core.security import sha256_hex
from app.models.cost_log import CostLog
from app.models.resume import Resume
from app.parsers.preprocess import detect_format, preprocess
from app.repositories.cost_log_repo import CostLogRepository
from app.repositories.fill_cache_repo import FillPlanCacheRepository
from app.repositories.resume_repo import ResumeRepository
from app.services.parsing_service import ParsingService


log = get_logger("resume_service")
OCR_PREFERRED_FORMATS = {"pdf", "png", "jpg", "jpeg"}
THINKING_MODE_ALIASES = {
    "enabled": "enabled",
    "on": "enabled",
    "true": "enabled",
    "1": "enabled",
    "disabled": "disabled",
    "off": "disabled",
    "false": "disabled",
    "0": "disabled",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _content_hash_prefix(content_hash: str) -> str:
    return content_hash[:12]


def _doc_trace_fields(doc) -> dict[str, int | bool]:
    return {
        "image_count": len(doc.images),
        "image_bytes": sum(len(img) for img in doc.images if isinstance(img, bytes)),
        "has_text": bool(doc.text),
        "text_chars": len(doc.text or ""),
    }


def _parsed_data_trace_fields(data: dict[str, Any]) -> dict[str, int]:
    return {
        "parsed_json_chars": len(json.dumps(data, ensure_ascii=False)),
        "education_count": len(data.get("education") or []),
        "internship_experience_count": len(data.get("internship_experience") or []),
        "work_experience_count": len(data.get("work_experience") or []),
        "campus_experience_count": len(data.get("campus_experience") or []),
        "project_experience_count": len(data.get("project_experience") or []),
        "facts_count": len(data.get("facts") or []),
        "extra_sections_count": len(data.get("extra_sections") or []),
    }


def _apply_thinking_mode(model: Any, mode: str | None) -> str:
    if mode:
        normalized = THINKING_MODE_ALIASES.get(mode.strip().lower())
        if normalized is None:
            raise ValidationError(
                "Unsupported thinking mode. Use 'enabled' or 'disabled'.",
                code="VALIDATION_THINKING_MODE_INVALID",
            )
        setter = getattr(model, "set_thinking_mode", None)
        if callable(setter):
            setter(normalized)
    return str(getattr(model, "thinking_mode", mode or "disabled"))


def deep_merge(base: dict, patch: dict) -> dict:
    """Recursive dict merge. Lists/scalars in patch overwrite base."""
    out = dict(base)
    for k, v in patch.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


class ResumeService:
    def __init__(
        self,
        session: AsyncSession,
        storage: StorageBackend,
        parsing: ParsingService | None = None,
    ) -> None:
        self.session = session
        self.storage = storage
        self.parsing = parsing
        self.repo = ResumeRepository(session)
        self.cost_repo = CostLogRepository(session)
        self.cache_repo = FillPlanCacheRepository(session)

    # ---------------- upload + sync parse ----------------
    async def upload_and_parse(
        self,
        user_id: str,
        filename: str,
        content: bytes,
        thinking_mode: str | None = None,
    ) -> Resume:
        settings = get_settings()
        parsing = self._require_parsing()
        effective_thinking_mode = _apply_thinking_mode(parsing.model, thinking_mode)
        if len(content) > settings.max_file_size_bytes:
            raise ValidationError(
                f"File exceeds {settings.max_file_size_mb} MB",
                code="VALIDATION_FILE_TOO_LARGE",
                details={"max_mb": settings.max_file_size_mb},
            )

        fmt = detect_format(filename)
        content_hash = sha256_hex(content)
        log.info(
            "resume_upload_received",
            user_id=user_id,
            file_format=fmt,
            file_size=len(content),
            content_hash_prefix=_content_hash_prefix(content_hash),
            thinking_mode=effective_thinking_mode,
        )

        # Dedup: same (user, content_hash) returns existing.
        existing = await self.repo.by_content_hash(user_id, content_hash)
        log.info(
            "resume_dedup_checked",
            user_id=user_id,
            content_hash_prefix=_content_hash_prefix(content_hash),
            existing_resume_id=existing.id if existing else None,
            existing_status=existing.parse_status if existing else None,
        )
        if existing is not None and existing.parse_status == "completed":
            log.info("resume_dedup_hit", user_id=user_id, resume_id=existing.id)
            return existing
        if existing is not None and existing.parse_status in {"pending", "processing"}:
            log.info("resume_dedup_in_progress", user_id=user_id, resume_id=existing.id)
            return existing

        resume = existing or Resume(
            user_id=user_id,
            original_filename=filename,
            file_format=fmt,
            file_size=len(content),
            file_storage_key="",  # set below
            content_hash=content_hash,
            parse_status="pending",
        )

        if existing is None:
            await self.repo.add(resume)
            log.info("resume_record_created", user_id=user_id, resume_id=resume.id)
        else:
            log.info(
                "resume_failed_record_reused",
                user_id=user_id,
                resume_id=resume.id,
                previous_status=existing.parse_status,
            )

        bind_contextvars(user_id=user_id, resume_id=resume.id)

        # Persist raw file
        storage_key = f"{user_id}/{resume.id}/{filename}"
        await self.storage.save(storage_key, content)
        log.info(
            "resume_file_saved",
            user_id=user_id,
            resume_id=resume.id,
            file_size=len(content),
            file_format=fmt,
        )
        resume.file_storage_key = storage_key
        resume.parse_status = "processing"
        resume.parse_started_at = _utcnow()
        resume.parse_error = None
        await self.session.flush()
        # SQLite keeps a write lock for the whole transaction. Commit the
        # status/file metadata before the long model call so duplicate uploads
        # or other writes don't fail with "database is locked" for 80+ seconds.
        await self.session.commit()
        log.info("resume_processing_committed", user_id=user_id, resume_id=resume.id)

        # Run preprocessing + parsing synchronously (3-DAY MVP)
        try:
            log.info("resume_model_parse_started", user_id=user_id, resume_id=resume.id)
            outcome = await self._parse_by_file_type(
                user_id=user_id,
                resume_id=resume.id,
                filename=filename,
                content=content,
                fmt=fmt,
            )
        except Exception as exc:
            resume.parse_status = "failed"
            resume.parse_error = str(exc)[:500]
            resume.parse_completed_at = _utcnow()
            log.warning("parse_failed", user_id=user_id, resume_id=resume.id, error=str(exc)[:200])
            await self._log_cost(user_id, "parsing", model_id="unknown", success=False)
            await self.session.commit()
            raise

        parsed_data = outcome.data.model_dump(mode="json")
        resume.parsed_data = parsed_data
        resume.schema_version = outcome.data.schema_version
        resume.parse_status = "completed"
        resume.parse_completed_at = _utcnow()
        resume.parse_error = None
        resume.parse_model = outcome.response.model_id
        resume.parse_input_tokens = outcome.response.input_tokens
        resume.parse_output_tokens = outcome.response.output_tokens
        resume.parse_cost_cny = outcome.response.cost_cny
        log.info(
            "resume_parse_completed",
            user_id=user_id,
            resume_id=resume.id,
            model=outcome.response.model_id,
            schema_version=outcome.data.schema_version,
            input_tokens=outcome.response.input_tokens,
            output_tokens=outcome.response.output_tokens,
            model_latency_ms=outcome.response.latency_ms,
            cost_cny=float(outcome.response.cost_cny),
            **_parsed_data_trace_fields(parsed_data),
        )

        await self._log_successful_parse_cost(user_id, outcome)
        log.info("resume_cost_logged", user_id=user_id, resume_id=resume.id, model=outcome.response.model_id)
        return resume

    # ---------------- read ----------------
    async def get(self, user_id: str, resume_id: str) -> Resume:
        resume = await self.repo.get(resume_id)
        if resume is None:
            raise NotFoundError("Resume not found", code="NOT_FOUND_RESUME")
        if resume.user_id != user_id:
            raise ForbiddenError("Access denied", code="FORBIDDEN_RESUME")
        return resume

    async def get_default(self, user_id: str) -> Resume:
        resume = await self.repo.latest_for_user(user_id)
        if resume is None:
            raise NotFoundError("No resume found for user", code="NOT_FOUND_RESUME")
        return resume

    async def list_for_user(self, user_id: str):
        return await self.repo.list_for_user(user_id)

    async def get_original_file(self, user_id: str, resume_id: str) -> tuple[Resume, bytes]:
        """Return the user's stored original resume file bytes."""
        resume = await self.get(user_id, resume_id)
        if not resume.file_storage_key:
            raise NotFoundError("Resume file not found", code="NOT_FOUND_FILE")
        content = await self.storage.get(resume.file_storage_key)
        return resume, content

    # ---------------- patch ----------------
    async def patch(self, user_id: str, resume_id: str, patch: dict[str, Any]) -> Resume:
        resume = await self.get(user_id, resume_id)
        if resume.parse_status != "completed" or resume.parsed_data is None:
            raise BusinessError(
                "Cannot patch a resume that has not been successfully parsed",
                code="BUSINESS_RESUME_NOT_PARSED",
            )
        merged = deep_merge(resume.parsed_data, patch)
        resume.parsed_data = merged
        resume.parsed_data_version += 1
        await self.cache_repo.delete_for_resume(user_id=user_id, resume_id=resume_id)
        await self.session.flush()
        return resume

    # ---------------- delete ----------------
    async def delete(self, user_id: str, resume_id: str) -> None:
        resume = await self.get(user_id, resume_id)
        await self.cache_repo.delete_for_resume(user_id=user_id, resume_id=resume_id)
        if resume.file_storage_key:
            await self.storage.delete(resume.file_storage_key)
        await self.repo.delete(resume)
        await self.session.flush()

    # ---------------- reparse ----------------
    async def reparse(self, user_id: str, resume_id: str, thinking_mode: str | None = None) -> Resume:
        """Re-run parsing on the already-uploaded file. Useful when the previous
        attempt was truncated or used a stale model configuration."""
        resume = await self.get(user_id, resume_id)
        parsing = self._require_parsing()
        effective_thinking_mode = _apply_thinking_mode(parsing.model, thinking_mode)
        bind_contextvars(user_id=user_id, resume_id=resume_id)
        log.info(
            "resume_reparse_requested",
            user_id=user_id,
            resume_id=resume_id,
            previous_status=resume.parse_status,
            previous_schema_version=resume.schema_version,
            thinking_mode=effective_thinking_mode,
        )
        content = await self.storage.get(resume.file_storage_key)
        log.info(
            "resume_file_loaded",
            user_id=user_id,
            resume_id=resume_id,
            file_size=len(content),
            file_format=resume.file_format,
        )
        resume.parse_status = "processing"
        resume.parse_started_at = _utcnow()
        resume.parse_error = None
        await self.session.flush()
        await self.session.commit()
        log.info("resume_processing_committed", user_id=user_id, resume_id=resume_id)

        try:
            log.info("resume_model_parse_started", user_id=user_id, resume_id=resume_id)
            outcome = await self._parse_by_file_type(
                user_id=user_id,
                resume_id=resume_id,
                filename=resume.original_filename,
                content=content,
                fmt=resume.file_format,
            )
        except Exception as exc:
            resume.parse_status = "completed" if resume.parsed_data is not None else "failed"
            resume.parse_error = str(exc)[:500]
            resume.parse_completed_at = _utcnow()
            log.warning("reparse_failed", user_id=user_id, resume_id=resume_id, error=str(exc)[:200])
            await self._log_cost(user_id, "parsing", model_id="unknown", success=False)
            await self.session.commit()
            raise

        parsed_data = outcome.data.model_dump(mode="json")
        resume.parsed_data = parsed_data
        resume.schema_version = outcome.data.schema_version
        resume.parse_status = "completed"
        resume.parse_completed_at = _utcnow()
        resume.parse_error = None
        resume.parse_model = outcome.response.model_id
        resume.parse_input_tokens = outcome.response.input_tokens
        resume.parse_output_tokens = outcome.response.output_tokens
        resume.parse_cost_cny = outcome.response.cost_cny
        resume.parsed_data_version += 1
        await self.cache_repo.delete_for_resume(user_id=user_id, resume_id=resume_id)
        log.info(
            "resume_reparse_completed",
            user_id=user_id,
            resume_id=resume_id,
            model=outcome.response.model_id,
            schema_version=outcome.data.schema_version,
            input_tokens=outcome.response.input_tokens,
            output_tokens=outcome.response.output_tokens,
            model_latency_ms=outcome.response.latency_ms,
            cost_cny=float(outcome.response.cost_cny),
            **_parsed_data_trace_fields(parsed_data),
        )

        await self._log_successful_parse_cost(user_id, outcome)
        log.info("resume_cost_logged", user_id=user_id, resume_id=resume_id, model=outcome.response.model_id)
        return resume

    async def _parse_by_file_type(
        self,
        *,
        user_id: str,
        resume_id: str,
        filename: str,
        content: bytes,
        fmt: str,
    ):
        parsing = self._require_parsing()
        ocr_model_id = getattr(parsing.model, "ocr_model_id", "")
        if fmt in OCR_PREFERRED_FORMATS and ocr_model_id:
            log.info(
                "resume_ocr_parse_selected",
                user_id=user_id,
                resume_id=resume_id,
                file_format=fmt,
                ocr_model=ocr_model_id,
            )
            try:
                return await parsing.parse_with_ocr(filename=filename, content=content)
            except Exception as exc:
                log.warning(
                    "resume_ocr_parse_failed_falling_back",
                    user_id=user_id,
                    resume_id=resume_id,
                    file_format=fmt,
                    ocr_model=ocr_model_id,
                    error=str(exc)[:200],
                )

        log.info(
            "resume_preprocess_started",
            user_id=user_id,
            resume_id=resume_id,
            file_format=fmt,
            parser_route="vision",
        )
        doc = preprocess(filename, content)
        log.info(
            "resume_preprocess_done",
            user_id=user_id,
            resume_id=resume_id,
            file_format=fmt,
            **_doc_trace_fields(doc),
        )
        return await parsing.parse(doc)

    def _require_parsing(self) -> ParsingService:
        if self.parsing is None:
            raise ConfigError("Model API key is missing")
        return self.parsing

    async def _log_successful_parse_cost(self, user_id: str, outcome) -> None:
        responses = outcome.responses or [outcome.response]
        for response in responses:
            await self._log_cost(
                user_id,
                "parsing",
                model_id=response.model_id,
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
                cost_cny=float(response.cost_cny),
                latency_ms=response.latency_ms,
                success=True,
            )

    # ---------------- cost helper ----------------
    async def _log_cost(
        self,
        user_id: str,
        stage: str,
        *,
        model_id: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_cny: float = 0.0,
        latency_ms: int = 0,
        success: bool = True,
    ) -> None:
        from decimal import Decimal
        await self.cost_repo.add(CostLog(
            user_id=user_id,
            stage=stage,
            model_id=model_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_cny=Decimal(str(cost_cny)),
            latency_ms=latency_ms,
            success=success,
        ))
