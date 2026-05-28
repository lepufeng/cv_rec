"""FillPlan cache table."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class FillPlanCache(Base, TimestampMixin):
    __tablename__ = "fill_plan_cache"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    resume_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("resumes.id", ondelete="CASCADE"), nullable=False,
    )
    resume_data_version: Mapped[int] = mapped_column(Integer, nullable=False)
    site_domain: Mapped[str] = mapped_column(String(255), nullable=False)
    form_structure_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    plan_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    hit_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        Index(
            "ix_fillcache_lookup",
            "user_id", "resume_id", "form_structure_hash",
        ),
    )
