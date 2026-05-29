"""Stage A: drive the multimodal model and validate output."""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from pydantic import ValidationError as PydanticValidationError

from app.adapters.models.base import ModelResponse
from app.core.exceptions import BusinessError, ModelError
from app.core.logging import get_logger
from app.parsers.preprocess import PreprocessedDoc
from app.prompts.parse_resume import (
    STRICT_RETRY_SUFFIX,
    SYSTEM_PROMPT,
    build_user_prompt,
)
from app.schemas.resume import ResumeData
from app.services.model_debug import capture_invalid_model_output


log = get_logger("parsing")


@dataclass(slots=True)
class ParseOutcome:
    data: ResumeData
    response: ModelResponse
    responses: list[ModelResponse] = field(default_factory=list)


class ParsingService:
    def __init__(self, model) -> None:
        self.model = model

    async def parse_with_ocr(self, *, filename: str, content: bytes) -> ParseOutcome:
        """Run GLM-OCR/layout parsing first, then structure the OCR text."""
        model_id = getattr(self.model, "ocr_model_id", "unknown")
        log.info(
            "parse_ocr_started",
            model=model_id,
            filename=filename,
            file_bytes=len(content),
        )
        ocr_response = await self.model.ocr_document(filename=filename, content=content)
        log.info(
            "parse_ocr_done",
            model=ocr_response.model_id,
            input_tokens=ocr_response.input_tokens,
            output_tokens=ocr_response.output_tokens,
            latency_ms=ocr_response.latency_ms,
            ocr_text_chars=len(ocr_response.content),
        )
        structured = await self.parse_text(ocr_response.content, source="ocr")
        merged = _merge_responses([ocr_response, structured.response])
        return ParseOutcome(
            data=structured.data,
            response=merged,
            responses=[ocr_response, structured.response],
        )

    async def parse(self, doc: PreprocessedDoc) -> ParseOutcome:
        if not doc.images and not doc.text:
            raise BusinessError(
                "Document has no extractable content",
                code="BUSINESS_EMPTY_DOC",
            )

        model_id = getattr(self.model, "vision_model_id", "unknown")
        log.info(
            "parse_input_ready",
            model=model_id,
            image_count=len(doc.images),
            image_bytes=sum(len(img) for img in doc.images if isinstance(img, bytes)),
            has_text=bool(doc.text),
            text_chars=len(doc.text or ""),
        )

        # If images are missing (eg DOCX text-only), still hit the vision endpoint
        # — multimodal models gracefully accept text-only inputs. We use vision_chat
        # but pass an empty image list, which our adapter handles.
        system = SYSTEM_PROMPT
        user = build_user_prompt(doc.text)

        # First attempt
        log.info("parse_model_request_started", model=model_id, attempt=1)
        response = await self.model.vision_chat(
            system=system, user=user, images=doc.images, response_format="json", temperature=0.0,
        )
        log.info(
            "parse_model_response_received",
            model=response.model_id,
            attempt=1,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            latency_ms=response.latency_ms,
            response_chars=len(response.content),
        )
        parsed = self._try_parse(
            response.content,
            model=response.model_id,
            attempt=1,
            context={"route": "vision", "image_count": len(doc.images), "has_text": bool(doc.text)},
        )
        if parsed is not None:
            log.info(
                "parse_schema_validated",
                model=response.model_id,
                attempt=1,
                schema_version=parsed.schema_version,
                **_resume_counts(parsed),
            )
            return ParseOutcome(data=parsed, response=response, responses=[response])

        log.warning(
            "parse_first_attempt_invalid",
            model=response.model_id,
            response_chars=len(response.content),
        )

        # Retry once with stricter wording
        log.info("parse_model_request_started", model=model_id, attempt=2)
        response2 = await self.model.vision_chat(
            system=system + STRICT_RETRY_SUFFIX,
            user=user,
            images=doc.images,
            response_format="json",
            temperature=0.0,
        )
        log.info(
            "parse_model_response_received",
            model=response2.model_id,
            attempt=2,
            input_tokens=response2.input_tokens,
            output_tokens=response2.output_tokens,
            latency_ms=response2.latency_ms,
            response_chars=len(response2.content),
        )
        parsed2 = self._try_parse(
            response2.content,
            model=response2.model_id,
            attempt=2,
            context={"route": "vision", "image_count": len(doc.images), "has_text": bool(doc.text)},
        )
        if parsed2 is None:
            log.warning(
                "parse_schema_invalid_after_retry",
                model=response2.model_id,
                first_response_chars=len(response.content),
                retry_response_chars=len(response2.content),
            )
            raise ModelError(
                "Model output failed Schema validation after retry",
                code="MODEL_SCHEMA_INVALID",
                details={"first_preview": response.content[:200], "retry_preview": response2.content[:200]},
            )
        # Aggregate token usage so caller gets the full bill
        merged = ModelResponse(
            content=response2.content,
            model_id=response2.model_id,
            input_tokens=response.input_tokens + response2.input_tokens,
            output_tokens=response.output_tokens + response2.output_tokens,
            cost_cny=response.cost_cny + response2.cost_cny,
            latency_ms=response.latency_ms + response2.latency_ms,
            raw=response2.raw,
        )
        log.info(
            "parse_schema_validated",
            model=response2.model_id,
            attempt=2,
            schema_version=parsed2.schema_version,
            **_resume_counts(parsed2),
        )
        return ParseOutcome(data=parsed2, response=merged, responses=[merged])

    async def parse_text(self, text: str, *, source: str = "text") -> ParseOutcome:
        if not text:
            raise BusinessError(
                "Document has no extractable content",
                code="BUSINESS_EMPTY_DOC",
            )

        model_id = getattr(self.model, "chat_model_id", "unknown")
        log.info(
            "parse_text_input_ready",
            model=model_id,
            source=source,
            text_chars=len(text),
        )
        system = SYSTEM_PROMPT
        user = build_user_prompt(text)

        log.info("parse_model_request_started", model=model_id, attempt=1, source=source)
        response = await self.model.chat(
            system=system, user=user, response_format="json", temperature=0.0,
        )
        log.info(
            "parse_model_response_received",
            model=response.model_id,
            attempt=1,
            source=source,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            latency_ms=response.latency_ms,
            response_chars=len(response.content),
        )
        parsed = self._try_parse(
            response.content,
            model=response.model_id,
            attempt=1,
            context={"route": "text", "source": source},
        )
        if parsed is not None:
            log.info(
                "parse_schema_validated",
                model=response.model_id,
                attempt=1,
                source=source,
                schema_version=parsed.schema_version,
                **_resume_counts(parsed),
            )
            return ParseOutcome(data=parsed, response=response, responses=[response])

        log.warning(
            "parse_first_attempt_invalid",
            model=response.model_id,
            source=source,
            response_chars=len(response.content),
        )

        log.info("parse_model_request_started", model=model_id, attempt=2, source=source)
        response2 = await self.model.chat(
            system=system + STRICT_RETRY_SUFFIX,
            user=user,
            response_format="json",
            temperature=0.0,
        )
        log.info(
            "parse_model_response_received",
            model=response2.model_id,
            attempt=2,
            source=source,
            input_tokens=response2.input_tokens,
            output_tokens=response2.output_tokens,
            latency_ms=response2.latency_ms,
            response_chars=len(response2.content),
        )
        parsed2 = self._try_parse(
            response2.content,
            model=response2.model_id,
            attempt=2,
            context={"route": "text", "source": source},
        )
        if parsed2 is None:
            log.warning(
                "parse_schema_invalid_after_retry",
                model=response2.model_id,
                source=source,
                first_response_chars=len(response.content),
                retry_response_chars=len(response2.content),
            )
            raise ModelError(
                "Model output failed Schema validation after retry",
                code="MODEL_SCHEMA_INVALID",
                details={"first_preview": response.content[:200], "retry_preview": response2.content[:200]},
            )

        merged = _merge_responses([response, response2], model_id=response2.model_id, content=response2.content)
        log.info(
            "parse_schema_validated",
            model=response2.model_id,
            attempt=2,
            source=source,
            schema_version=parsed2.schema_version,
            **_resume_counts(parsed2),
        )
        return ParseOutcome(data=parsed2, response=merged, responses=[merged])

    @staticmethod
    def _try_parse(
        raw: str,
        *,
        model: str | None = None,
        attempt: int | None = None,
        context: dict | None = None,
    ) -> ResumeData | None:
        text = _strip_codeblock(raw).strip()
        try:
            obj = json.loads(text)
        except json.JSONDecodeError as exc:
            debug_path = capture_invalid_model_output(
                stage="resume_parse",
                raw=raw,
                reason="json_invalid",
                model=model,
                attempt=attempt,
                errors=[{"type": "json_decode", "message": exc.msg, "line": exc.lineno, "column": exc.colno}],
                context=context,
            )
            log.warning(
                "parse_model_json_invalid",
                error=f"{exc.msg} at line {exc.lineno} column {exc.colno}",
                debug_path=debug_path,
            )
            return None
        try:
            return ResumeData.model_validate(obj)
        except PydanticValidationError as exc:
            errors = [
                {
                    "loc": ".".join(str(part) for part in error.get("loc", ())),
                    "type": error.get("type"),
                }
                for error in exc.errors()[:5]
            ]
            debug_path = capture_invalid_model_output(
                stage="resume_parse",
                raw=raw,
                reason="schema_invalid",
                model=model,
                attempt=attempt,
                errors=errors,
                context=context,
            )
            log.warning("parse_model_schema_invalid", errors=errors, debug_path=debug_path)
            return None


def _strip_codeblock(text: str) -> str:
    """Strip leading/trailing ```json fences if the model added them."""
    t = text.strip()
    if t.startswith("```"):
        # remove first fence line
        first_newline = t.find("\n")
        if first_newline != -1:
            t = t[first_newline + 1:]
        if t.endswith("```"):
            t = t[: -3]
    return t.strip()


def _merge_responses(
    responses: list[ModelResponse],
    *,
    model_id: str | None = None,
    content: str | None = None,
) -> ModelResponse:
    if not responses:
        return ModelResponse(content="", model_id="unknown")
    return ModelResponse(
        content=content if content is not None else responses[-1].content,
        model_id=model_id or "+".join(response.model_id for response in responses),
        input_tokens=sum(response.input_tokens for response in responses),
        output_tokens=sum(response.output_tokens for response in responses),
        cost_cny=sum((response.cost_cny for response in responses), responses[0].cost_cny * 0),
        latency_ms=sum(response.latency_ms for response in responses),
        raw={"responses": [response.raw for response in responses]},
    )


def _resume_counts(data: ResumeData) -> dict[str, int]:
    return {
        "education_count": len(data.education),
        "internship_experience_count": len(data.internship_experience),
        "work_experience_count": len(data.work_experience),
        "campus_experience_count": len(data.campus_experience),
        "project_experience_count": len(data.project_experience),
        "facts_count": len(data.facts),
        "extra_sections_count": len(data.extra_sections),
    }
