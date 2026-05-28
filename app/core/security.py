"""Security helpers: password hashing + signed session tokens.

Passwords use PBKDF2-HMAC-SHA256 with a per-user random salt.
Sessions are stateless: an HMAC-signed JSON payload that carries
`{user_id, role, exp}`. Server-side revocation isn't needed for MVP.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from app.core.config import get_settings
from app.core.exceptions import AuthError


# ---------------- password hashing ----------------

_PBKDF2_ITERATIONS = 200_000
_PBKDF2_ALGO = "sha256"
_SALT_BYTES = 16


def hash_password(password: str) -> str:
    """Return `pbkdf2_sha256$iterations$salt$hash` as a single string."""
    if not password:
        raise ValueError("password must not be empty")
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(_PBKDF2_ALGO, password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iters_str, salt_b64, hash_b64 = stored.split("$", 3)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    try:
        iterations = int(iters_str)
        salt = _b64d(salt_b64)
        expected = _b64d(hash_b64)
    except (ValueError, TypeError):
        return False
    candidate = hashlib.pbkdf2_hmac(_PBKDF2_ALGO, password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected)


# ---------------- signed session tokens ----------------

DEFAULT_TOKEN_TTL = 7 * 24 * 3600  # 7 days


def issue_token(user_id: str, role: str, ttl: int = DEFAULT_TOKEN_TTL) -> str:
    payload = {
        "uid": user_id,
        "role": role,
        "exp": int(time.time()) + ttl,
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _sign(body)
    return f"{body}.{sig}"


def verify_token(token: str) -> dict[str, Any]:
    if not token or "." not in token:
        raise AuthError("Malformed token", code="AUTH_BAD_TOKEN")
    body, sig = token.rsplit(".", 1)
    expected_sig = _sign(body)
    if not hmac.compare_digest(sig, expected_sig):
        raise AuthError("Invalid token signature", code="AUTH_BAD_SIGNATURE")
    try:
        payload = json.loads(_b64d(body).decode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise AuthError("Corrupt token payload", code="AUTH_BAD_TOKEN") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise AuthError("Token expired", code="AUTH_TOKEN_EXPIRED")
    return payload


# ---------------- helpers ----------------

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64d(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def _sign(body: str) -> str:
    secret = get_settings().secret_key.encode("utf-8")
    digest = hmac.new(secret, body.encode("utf-8"), hashlib.sha256).digest()
    return _b64(digest)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
