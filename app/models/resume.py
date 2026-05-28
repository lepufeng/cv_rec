"""Resume ORM model."""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Resume(Base, TimestampMixin):
    __tablename__ = "resumes"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )

    # Original file metadata
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_format: Mapped[str] = mapped_column(String(16), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    file_storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Parse status & metadata
    parse_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending",  # pending | processing | completed | failed
    )
    parse_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    parse_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    parse_error: Mapped[str | None] = mapped_column(Text)
    parse_model: Mapped[str | None] = mapped_column(String(64))
    parse_input_tokens: Mapped[int | None] = mapped_column(Integer)
    parse_output_tokens: Mapped[int | None] = mapped_column(Integer)
    parse_cost_cny: Mapped[Decimal | None] = mapped_column(Numeric(10, 6))

    # Parsed result
    schema_version: Mapped[str] = mapped_column(String(16), default="1.6", nullable=False)
    parsed_data: Mapped[dict | None] = mapped_column(JSON)
    parsed_data_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    __table_args__ = (
        Index("ix_resumes_user_hash", "user_id", "content_hash"),
    )
