"""Local diagnostics for model outputs that fail schema validation."""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger


log = get_logger("model_debug")


def capture_invalid_model_output(
    *,
    stage: str,
    raw: str,
    reason: str,
    model: str | None = None,
    attempt: int | None = None,
    errors: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
) -> str | None:
    """Persist an invalid model response for local debugging.

    This is intentionally disabled in production because model responses can
    contain resume personal data. It captures the response body, never the
    prompt.
    """
    settings = get_settings()
    if settings.app_env == "prod" or not settings.debug_capture_invalid_model_outputs:
        return None

    raw_text = raw if isinstance(raw, str) else str(raw)
    max_chars = max(int(settings.debug_invalid_model_output_max_chars or 0), 0)
    truncated = max_chars > 0 and len(raw_text) > max_chars
    captured = raw_text[:max_chars] if truncated else raw_text

    output_dir = Path(settings.debug_invalid_model_output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    stage_slug = re.sub(r"[^a-zA-Z0-9_.-]+", "_", stage).strip("_") or "model"
    filename = f"{now.strftime('%Y%m%dT%H%M%S%fZ')}_{stage_slug}_{uuid.uuid4().hex[:8]}.json"
    path = output_dir / filename

    payload = {
        "created_at": now.isoformat(),
        "stage": stage,
        "reason": reason,
        "model": model,
        "attempt": attempt,
        "errors": errors or [],
        "context": context or {},
        "raw_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
        "raw_chars": len(raw_text),
        "truncated": truncated,
        "raw": captured,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log.warning(
        "invalid_model_output_captured",
        stage=stage,
        reason=reason,
        model=model,
        attempt=attempt,
        raw_chars=len(raw_text),
        truncated=truncated,
        path=str(path),
    )
    return str(path)
