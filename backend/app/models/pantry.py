import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, Enum, Float, ForeignKey, Numeric, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReservationType(str, enum.Enum):
    PLAN = "plan"
    ACTIVE_COOK = "active_cook"


class PantryItem(Base):
    __tablename__ = "pantry_items"
    __table_args__ = (
        UniqueConstraint("ingredient_id", "household_id", name="uq_pantry_item_ingredient_household"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"), nullable=False
    )
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ingredients.id"), nullable=False
    )
    quantity: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    unit: Mapped[str] = mapped_column(Text, nullable=False)
    # 0–1; effective_quantity = quantity × confidence
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    last_confirmed_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    # Per-day confidence decay rate; fridge items ~0.1, pantry ~0.02
    decay_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.02)
    # Optional explicit best-before date; when set, drives confidence instead of decay_rate
    expires_at: Mapped[Optional[date]] = mapped_column(Date(), nullable=True)

    # Relationships
    ingredient: Mapped["Ingredient"] = relationship(back_populates="pantry_items")  # noqa: F821
    reservations: Mapped[list["PantryReservation"]] = relationship(
        back_populates="pantry_item", cascade="all, delete-orphan"
    )


class PantryReservation(Base):
    """
    Prevents the same ingredient being double-counted across the matcher,
    planner, and active cooking sessions.
    Availability = pantry_item.quantity × confidence − sum(reservations)
    """
    __tablename__ = "pantry_reservations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pantry_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pantry_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipe_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False
    )
    # In canonical units (g, ml, or count)
    quantity: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    reserved_for: Mapped[ReservationType] = mapped_column(
        Enum(ReservationType, name="reservation_type"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    pantry_item: Mapped["PantryItem"] = relationship(back_populates="reservations")
    recipe: Mapped["Recipe"] = relationship(back_populates="pantry_reservations")  # noqa: F821
