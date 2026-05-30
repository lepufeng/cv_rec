"""Generic OpenAI-compatible chat completions client.

Both Zhipu (z.ai / bigmodel) and Alibaba DashScope expose an OpenAI-compatible
endpoint. This client wraps `POST /chat/completions` for both text and
vision modalities.

Vision message format follows OpenAI: the user message becomes a list of
content parts mixing `{"type": "text", ...}` and
`{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}`.
"""
from __future__ import annotations

import base64
import asyncio
import time
from typing import Any
from urllib.parse import urlparse
from pathlib import Path

import httpx

from app.adapters.models.base import ModelResponse, ResponseFormat
from app.adapters.models.pricing import estimate_cost
from app.core.exceptions import ModelError
from app.core.logging import get_logger


log = get_logger("model.openai_compat")
_MAX_HTTP_ATTEMPTS = 3
_RETRYABLE_STATUS = {408, 409, 429, 500, 502, 503, 504}


class OpenAICompatClient:
    """Adapter for OpenAI-compatible chat completion endpoints."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        ocr_model: str = "",
        chat_model: str,
        vision_model: str,
        thinking_mode: str = "disabled",
        network_mode: str = "direct",
        proxy_url: str = "",
        timeout_seconds: float = 180.0,
        max_tokens: int = 8192,
    ) -> None:
        if not api_key:
            raise ModelError("Model API key is missing")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._ocr_model = ocr_model
        self._chat_model = chat_model
        self._vision_model = vision_model
        self._thinking_mode = _normalize_thinking_mode(thinking_mode)
        self._network_mode = _normalize_network_mode(network_mode)
        self._proxy_url = proxy_url.strip()
        self._timeout = httpx.Timeout(timeout_seconds)
        self._max_tokens = max_tokens

    @property
    def chat_model_id(self) -> str:
        return self._chat_model

    @property
    def vision_model_id(self) -> str:
        return self._vision_model

    @property
    def ocr_model_id(self) -> str:
        return self._ocr_model

    @property
    def thinking_mode(self) -> str:
        return self._thinking_mode

    @property
    def network_mode(self) -> str:
        return self._network_mode

    @property
    def proxy_url(self) -> str:
        return self._proxy_url

    def set_thinking_mode(self, mode: str | None) -> None:
        if mode:
            self._thinking_mode = _normalize_thinking_mode(mode)

    def _http_client(self) -> httpx.AsyncClient:
        if self._network_mode == "proxy":
            return httpx.AsyncClient(
                timeout=self._timeout,
                proxy=self._proxy_url or None,
                trust_env=False,
            )
        if self._network_mode == "environment":
            return httpx.AsyncClient(timeout=self._timeout, trust_env=True)
        return httpx.AsyncClient(timeout=self._timeout, trust_env=False)

    # ---------- chat ----------
    async def chat(
        self,
        system: str,
        user: str,
        *,
        response_format: ResponseFormat = "json",
        temperature: float = 0.0,
    ) -> ModelResponse:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        return await self._invoke(self._chat_model, messages, response_format, temperature)

    # ---------- vision ----------
    async def vision_chat(
        self,
        system: str,
        user: str,
        images: list[bytes | str],
        *,
        response_format: ResponseFormat = "json",
        temperature: float = 0.0,
    ) -> ModelResponse:
        content: list[dict[str, Any]] = [{"type": "text", "text": user}]
        for img in images:
            content.append({
                "type": "image_url",
                "image_url": {"url": _as_image_url(img)},
            })
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ]
        return await self._invoke(self._vision_model, messages, response_format, temperature)

    # ---------- OCR / layout parsing ----------
    async def ocr_document(
        self,
        *,
        filename: str,
        content: bytes,
    ) -> ModelResponse:
        if not self._ocr_model:
            raise ModelError("OCR model is not configured", code="MODEL_OCR_NOT_CONFIGURED")

        payload: dict[str, Any] = {
            "model": self._ocr_model,
            "file": _as_document_data_url(filename, content),
            "return_crop_images": False,
            "need_layout_visualization": False,
        }
        url = f"{self._base_url}/layout_parsing"
        endpoint_host = urlparse(url).netloc
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        start = time.perf_counter()
        resp: httpx.Response | None = None
        last_http_error: httpx.HTTPError | None = None
        for attempt in range(1, _MAX_HTTP_ATTEMPTS + 1):
            attempt_start = time.perf_counter()
            log.info(
                "ocr_http_request_started",
                model=self._ocr_model,
                attempt=attempt,
                max_attempts=_MAX_HTTP_ATTEMPTS,
                endpoint_host=endpoint_host,
                network_mode=self._network_mode,
                file_ext=Path(filename).suffix.lower().lstrip("."),
                file_bytes=len(content),
            )
            try:
                async with self._http_client() as client:
                    resp = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                last_http_error = exc
                error = _http_error_summary(exc)
                attempt_latency_ms = int((time.perf_counter() - attempt_start) * 1000)
                log.warning(
                    "ocr_http_error",
                    model=self._ocr_model,
                    attempt=attempt,
                    latency_ms=attempt_latency_ms,
                    error=error[:200],
                    error_type=exc.__class__.__name__,
                )
                if attempt < _MAX_HTTP_ATTEMPTS:
                    await asyncio.sleep(0.5 * attempt)
                    continue
                raise ModelError(
                    f"HTTP error contacting OCR model: {error}",
                    code="MODEL_HTTP_ERROR",
                    details={"error_type": exc.__class__.__name__},
                ) from exc

            attempt_latency_ms = int((time.perf_counter() - attempt_start) * 1000)
            log.info(
                "ocr_http_response_received",
                model=self._ocr_model,
                attempt=attempt,
                status_code=resp.status_code,
                latency_ms=attempt_latency_ms,
            )
            if resp.status_code in _RETRYABLE_STATUS and attempt < _MAX_HTTP_ATTEMPTS:
                await asyncio.sleep(0.5 * attempt)
                continue
            break

        if resp is None:
            error = _http_error_summary(last_http_error)
            raise ModelError(
                f"HTTP error contacting OCR model: {error}",
                code="MODEL_HTTP_ERROR",
                details={"error_type": last_http_error.__class__.__name__ if last_http_error else None},
            )

        latency_ms = int((time.perf_counter() - start) * 1000)
        if resp.status_code >= 400:
            raise ModelError(
                f"OCR API returned {resp.status_code}: {resp.text[:300]}",
                code="MODEL_API_ERROR",
                details={"status": resp.status_code},
            )

        body = resp.json()
        content_text = _extract_ocr_text(body)
        if not content_text:
            raise ModelError(
                f"OCR API returned no extractable text: {str(body)[:300]}",
                code="MODEL_BAD_RESPONSE",
            )

        usage = _extract_usage(body)
        in_tokens = int(usage.get("prompt_tokens", 0))
        out_tokens = int(usage.get("completion_tokens", 0))
        cost_cny = estimate_cost(self._ocr_model, in_tokens, out_tokens)
        log.info(
            "ocr_response_parsed",
            model=self._ocr_model,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
            cost_cny=float(cost_cny),
            latency_ms=latency_ms,
            content_chars=len(content_text),
        )
        return ModelResponse(
            content=content_text,
            model_id=self._ocr_model,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
            cost_cny=cost_cny,
            latency_ms=latency_ms,
            raw=body,
        )

    # ---------- core ----------
    async def _invoke(
        self,
        model_id: str,
        messages: list[dict],
        response_format: ResponseFormat,
        temperature: float,
    ) -> ModelResponse:
        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": self._max_tokens,
        }
        if _should_disable_thinking(self._base_url, model_id, self._thinking_mode):
            payload["thinking"] = {"type": "disabled"}
        if response_format == "json":
            payload["response_format"] = {"type": "json_object"}

        url = f"{self._base_url}/chat/completions"
        endpoint_host = urlparse(url).netloc
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        message_stats = _message_trace_fields(messages)

        start = time.perf_counter()
        resp: httpx.Response | None = None
        last_http_error: httpx.HTTPError | None = None
        for attempt in range(1, _MAX_HTTP_ATTEMPTS + 1):
            attempt_start = time.perf_counter()
            log.info(
                "model_http_request_started",
                model=model_id,
                attempt=attempt,
                max_attempts=_MAX_HTTP_ATTEMPTS,
                endpoint_host=endpoint_host,
                response_format=response_format,
                temperature=temperature,
                max_tokens=self._max_tokens,
                thinking_mode=self._thinking_mode,
                network_mode=self._network_mode,
                **message_stats,
            )
            try:
                async with self._http_client() as client:
                    resp = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                last_http_error = exc
                error = _http_error_summary(exc)
                attempt_latency_ms = int((time.perf_counter() - attempt_start) * 1000)
                log.warning(
                    "model_http_error",
                    model=model_id,
                    attempt=attempt,
                    latency_ms=attempt_latency_ms,
                    error=error[:200],
                    error_type=exc.__class__.__name__,
                )
                if attempt < _MAX_HTTP_ATTEMPTS:
                    log.warning(
                        "model_http_retry",
                        model=model_id,
                        attempt=attempt,
                        error=error[:200],
                        error_type=exc.__class__.__name__,
                    )
                    await asyncio.sleep(0.5 * attempt)
                    continue
                raise ModelError(
                    f"HTTP error contacting model: {error}",
                    code="MODEL_HTTP_ERROR",
                    details={"error_type": exc.__class__.__name__},
                ) from exc

            attempt_latency_ms = int((time.perf_counter() - attempt_start) * 1000)
            log.info(
                "model_http_response_received",
                model=model_id,
                attempt=attempt,
                status_code=resp.status_code,
                latency_ms=attempt_latency_ms,
            )
            if resp.status_code in _RETRYABLE_STATUS and attempt < _MAX_HTTP_ATTEMPTS:
                log.warning(
                    "model_status_retry",
                    model=model_id,
                    attempt=attempt,
                    status=resp.status_code,
                )
                await asyncio.sleep(0.5 * attempt)
                continue
            break

        if resp is None:
            error = _http_error_summary(last_http_error)
            raise ModelError(
                f"HTTP error contacting model: {error}",
                code="MODEL_HTTP_ERROR",
                details={"error_type": last_http_error.__class__.__name__ if last_http_error else None},
            )

        latency_ms = int((time.perf_counter() - start) * 1000)

        if resp.status_code >= 400:
            raise ModelError(
                f"Model API returned {resp.status_code}: {resp.text[:300]}",
                code="MODEL_API_ERROR",
                details={"status": resp.status_code},
            )

        body = resp.json()
        try:
            choice = body["choices"][0]
            content = choice["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelError(
                f"Unexpected response shape: {body!r}",
                code="MODEL_BAD_RESPONSE",
            ) from exc

        # Detect truncation. When `finish_reason == "length"`, the model hit
        # max_tokens and the JSON is almost certainly malformed — bubble up
        # so the caller can retry with a stricter prompt or surface to the user.
        finish_reason = choice.get("finish_reason")
        if finish_reason == "length":
            usage_dump = body.get("usage", {})
            log.warning(
                "model_response_truncated",
                model=model_id,
                finish_reason=finish_reason,
                usage=usage_dump,
                max_tokens=self._max_tokens,
            )
            raise ModelError(
                "Model output truncated (finish_reason=length). "
                "Response exceeded max_tokens budget.",
                code="MODEL_OUTPUT_TRUNCATED",
                details={"usage": usage_dump, "max_tokens": self._max_tokens},
            )

        usage = body.get("usage", {}) or {}
        in_tokens = int(usage.get("prompt_tokens", 0))
        out_tokens = int(usage.get("completion_tokens", 0))
        cost_cny = estimate_cost(model_id, in_tokens, out_tokens)
        log.info(
            "model_response_parsed",
            model=model_id,
            finish_reason=finish_reason,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
            cost_cny=float(cost_cny),
            latency_ms=latency_ms,
            content_chars=len(content),
        )

        return ModelResponse(
            content=content,
            model_id=model_id,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
            cost_cny=cost_cny,
            latency_ms=latency_ms,
            raw=body,
        )


def _as_image_url(image: bytes | str) -> str:
    """Convert a bytes blob or http(s) URL to an OpenAI-compatible image_url."""
    if isinstance(image, str):
        if image.startswith("http://") or image.startswith("https://") or image.startswith("data:"):
            return image
        raise ValueError("String images must be http(s) or data: URLs")
    # Sniff a few magic bytes so we send the right mime type. Vision endpoints
    # (eg DashScope OpenAI-compat) reject `data:image/jpeg` when the payload
    # is actually PNG.
    if image[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    elif image[:3] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif image[:4] == b"GIF8":
        mime = "image/gif"
    elif image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        mime = "image/jpeg"
    encoded = base64.b64encode(image).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _normalize_thinking_mode(mode: str) -> str:
    normalized = (mode or "disabled").strip().lower()
    if normalized in {"enabled", "on", "true", "1"}:
        return "enabled"
    if normalized in {"disabled", "off", "false", "0"}:
        return "disabled"
    raise ModelError(
        "Unsupported thinking mode. Use 'enabled' or 'disabled'.",
        code="MODEL_THINKING_MODE_INVALID",
    )


def _normalize_network_mode(mode: str | None) -> str:
    normalized = (mode or "direct").strip().lower()
    if normalized in {"direct", "none", "off", "no_proxy", "no-proxy"}:
        return "direct"
    if normalized in {"environment", "env", "system"}:
        return "environment"
    if normalized in {"proxy", "custom"}:
        return "proxy"
    raise ModelError(
        "Unsupported model network mode. Use 'direct', 'environment', or 'proxy'.",
        code="MODEL_NETWORK_MODE_INVALID",
    )


def _should_disable_thinking(base_url: str, model_id: str, thinking_mode: str) -> bool:
    """Disable forced Thinking for GLM models used for strict JSON output."""
    if _normalize_thinking_mode(thinking_mode) != "disabled":
        return False
    if "bigmodel.cn" not in base_url:
        return False
    model = model_id.lower()
    return model.startswith("glm-5") or model.startswith("glm-4.7")


def _http_error_summary(exc: httpx.HTTPError | None) -> str:
    if exc is None:
        return "unknown HTTP error"
    message = str(exc).strip()
    error_type = exc.__class__.__name__
    if not message:
        return error_type
    if error_type in message:
        return message
    return f"{error_type}: {message}"


def _as_document_data_url(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext == "pdf":
        mime = "application/pdf"
    elif ext in {"jpg", "jpeg"}:
        mime = "image/jpeg"
    elif ext == "png":
        mime = "image/png"
    else:
        mime = "application/octet-stream"
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _extract_usage(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    usage = body.get("usage") or data.get("usage") or {}
    return usage if isinstance(usage, dict) else {}


def _extract_ocr_text(body: dict[str, Any]) -> str:
    raw_data = body.get("data")
    if isinstance(raw_data, str) and raw_data.strip():
        return raw_data.strip()
    data = raw_data if isinstance(raw_data, dict) else {}
    for container in (body, data):
        for key in ("md_results", "markdown", "text", "content", "result"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, list):
                joined = "\n\n".join(str(item).strip() for item in value if str(item).strip())
                if joined:
                    return joined

    details = body.get("layout_details") or data.get("layout_details")
    extracted = _flatten_layout_text(details)
    return extracted.strip()


def _flatten_layout_text(value: Any) -> str:
    if isinstance(value, dict):
        content = value.get("content")
        rest = "\n".join(_flatten_layout_text(v) for k, v in value.items() if k != "content")
        if isinstance(content, str):
            return "\n".join(part for part in (content, rest) if part)
        return rest
    if isinstance(value, list):
        return "\n".join(_flatten_layout_text(item) for item in value)
    return ""


def _message_trace_fields(messages: list[dict]) -> dict[str, int]:
    """Return payload-size metadata without logging prompt text or image data."""
    text_chars = 0
    image_count = 0
    content_part_count = 0
    for message in messages:
        content = message.get("content")
        if isinstance(content, str):
            text_chars += len(content)
            content_part_count += 1
            continue
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict):
                continue
            content_part_count += 1
            if part.get("type") == "text":
                text_chars += len(str(part.get("text") or ""))
            elif part.get("type") == "image_url":
                image_count += 1
    return {
        "message_count": len(messages),
        "content_part_count": content_part_count,
        "image_count": image_count,
        "text_chars": text_chars,
    }
