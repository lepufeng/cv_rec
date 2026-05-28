"""Replay the parse for an existing resume to inspect raw model output."""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import os
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./data/dev.db")
os.environ.setdefault("STORAGE_LOCAL_PATH", "./data/uploads")
os.environ.setdefault("MODEL_PROVIDER", "glm")
os.environ.setdefault("SECRET_KEY", "dev")

from app.adapters.models import build_model_from_config
from app.adapters.storage import get_storage
from app.core.db import session_scope
from app.parsers.preprocess import preprocess
from app.prompts.parse_resume import SYSTEM_PROMPT, build_user_prompt
from app.repositories.resume_repo import ResumeRepository
from app.services.config_service import ConfigService


async def main(resume_id: str, max_tokens: int | None):
    storage = get_storage()
    async with session_scope() as session:
        cfg = await ConfigService(session).get_model_config()
        client = build_model_from_config(cfg)
        resume = await ResumeRepository(session).get(resume_id)
        if resume is None:
            print(f"resume {resume_id} not found")
            return
        content = await storage.get(resume.file_storage_key)
        doc = preprocess(resume.original_filename, content)

    print(f"images: {len(doc.images)}, text bytes: {len(doc.text or '')}")

    # Hand-craft the request so we can inject max_tokens and read raw
    import base64, time, httpx
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": (
            [{"type": "text", "text": build_user_prompt(doc.text)}]
            + [{"type": "image_url", "image_url": {
                "url": f"data:image/jpeg;base64,{base64.b64encode(img).decode()}"
              }} for img in doc.images]
        )}
    ]
    payload = {
        "model": cfg.glm_vision_model,
        "messages": messages,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    headers = {"Authorization": f"Bearer {cfg.glm_api_key}", "Content-Type": "application/json"}
    url = f"{cfg.glm_base_url.rstrip('/')}/chat/completions"

    start = time.perf_counter()
    async with httpx.AsyncClient(timeout=180) as http:
        resp = await http.post(url, json=payload, headers=headers)
    elapsed = int((time.perf_counter() - start) * 1000)

    print(f"status={resp.status_code} elapsed={elapsed}ms")
    body = resp.json()

    print("\n----- usage -----")
    print(json.dumps(body.get("usage"), indent=2))

    choice = body["choices"][0]
    print(f"\n----- finish_reason: {choice.get('finish_reason')} -----")

    msg = choice["message"]
    print("\n----- message keys -----")
    print(list(msg.keys()))

    if "reasoning_content" in msg:
        rc = msg["reasoning_content"]
        print(f"\n----- reasoning_content (first 500 chars, total {len(rc)}) -----")
        print(rc[:500])

    content = msg.get("content", "")
    print(f"\n----- content (total {len(content)} chars) -----")
    print(content)


if __name__ == "__main__":
    rid = sys.argv[1] if len(sys.argv) > 1 else "6d29153d-913f-4032-be68-5aa9383cb797"
    max_tok = int(sys.argv[2]) if len(sys.argv) > 2 else None
    asyncio.run(main(rid, max_tok))
