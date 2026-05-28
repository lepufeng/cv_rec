"""Dump the exact images we send to the vision model, plus the source PDF info."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./data/dev.db")
os.environ.setdefault("STORAGE_LOCAL_PATH", "./data/uploads")
os.environ.setdefault("MODEL_PROVIDER", "glm")
os.environ.setdefault("SECRET_KEY", "dev")

from app.adapters.storage import get_storage
from app.core.db import session_scope
from app.parsers.preprocess import preprocess
from app.repositories.resume_repo import ResumeRepository


async def main():
    out_dir = Path("data/debug")
    out_dir.mkdir(parents=True, exist_ok=True)
    storage = get_storage()
    async with session_scope() as session:
        repo = ResumeRepository(session)
        from sqlalchemy import select
        from app.models.resume import Resume
        rows = (await session.execute(
            select(Resume).order_by(Resume.created_at.desc()).limit(1)
        )).scalars().all()
        if not rows:
            print("no resume")
            return
        resume = rows[0]

    raw = await storage.get(resume.file_storage_key)
    src_path = out_dir / f"src_{resume.id[:8]}_{resume.original_filename}"
    src_path.write_bytes(raw)
    print(f"wrote source: {src_path}  ({len(raw)} bytes)")

    doc = preprocess(resume.original_filename, raw)
    print(f"image count: {len(doc.images)}")
    for i, img in enumerate(doc.images):
        p = out_dir / f"page_{resume.id[:8]}_{i}.jpg"
        p.write_bytes(img)
        print(f"  wrote: {p}  ({len(img)} bytes)")
    if doc.text:
        (out_dir / "text.txt").write_text(doc.text, encoding="utf-8")
        print(f"  wrote text: {len(doc.text)} chars")


asyncio.run(main())
