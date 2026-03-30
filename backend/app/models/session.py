import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Integer, SmallInteger, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CookingSession(Base):
    __tablename__ = "cooking_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recipes.id"), nullable=False
    )
    current_step: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    # Array of completed step ordinals
    completed_steps: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), nullable=False, server_default="{}"
    )
    # JSON: { "<step_order>": { "seconds_remaining": int, "started_at": iso_string } }
    timers: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    started_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    # Relationships
    recipe: Mapped["Recipe"] = relationship(back_populates="cooking_sessions")  # noqa: F821
