import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Enum, ForeignKey, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class IngestStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    REVIEW = "review"
    COMPLETE = "complete"
    FAILED = "failed"


class IngestSourceType(str, enum.Enum):
    HELLOFRESH = "hellofresh"
    MANUAL = "manual"
    IMPORTED = "imported"


class IngestJob(Base):
    __tablename__ = "ingest_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status: Mapped[IngestStatus] = mapped_column(
        Enum(IngestStatus, name="ingest_status"), nullable=False, default=IngestStatus.QUEUED
    )
    image_dir: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[IngestSourceType] = mapped_column(
        Enum(IngestSourceType, name="ingest_source_type"), nullable=False, default=IngestSourceType.HELLOFRESH
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    llm_outputs: Mapped[list["LlmOutput"]] = relationship(
        back_populates="ingest_job", cascade="all, delete-orphan"
    )


class LlmOutput(Base):
    """
    Audit trail for LLM responses. Full raw_llm_response is stored here
    and NOT written to general logs (would bloat NAS log volumes).
    Rows expire after 90 days (expires_at enforced by a daily APScheduler job).
    """
    __tablename__ = "llm_outputs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ingest_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ingest_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Null until the job reaches 'complete' status
    recipe_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True
    )
    raw_llm_response: Mapped[dict] = mapped_column(JSONB, nullable=False)
    parsed_result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    user_corrected: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    # Default 90-day retention; deleted by APScheduler daily cleanup job
    expires_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now() + interval '90 days'"),
    )

    # Relationships
    ingest_job: Mapped["IngestJob"] = relationship(back_populates="llm_outputs")
