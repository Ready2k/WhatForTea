import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Enum, ForeignKey, Integer, Numeric, SmallInteger, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SourceType(str, enum.Enum):
    HELLOFRESH = "hellofresh"
    MANUAL = "manual"
    IMPORTED = "imported"


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    hero_image_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hello_fresh_style: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    cooking_time_mins: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    # All ingredient quantities are for this serving count
    base_servings: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=2)
    source_type: Mapped[SourceType] = mapped_column(
        Enum(SourceType, name="source_type"), nullable=False, default=SourceType.HELLOFRESH
    )
    source_reference: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    mood_tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan", order_by="RecipeIngredient.id"
    )
    steps: Mapped[list["Step"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan", order_by="Step.order"
    )
    meal_plan_entries: Mapped[list["MealPlanEntry"]] = relationship(  # noqa: F821
        back_populates="recipe"
    )
    cooking_sessions: Mapped[list["CookingSession"]] = relationship(  # noqa: F821
        back_populates="recipe"
    )
    pantry_reservations: Mapped[list["PantryReservation"]] = relationship(  # noqa: F821
        back_populates="recipe"
    )


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False
    )
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ingredients.id"), nullable=False
    )
    raw_name: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    unit: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Populated after the normalisation pass
    normalized_quantity: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)
    normalized_unit: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    recipe: Mapped["Recipe"] = relationship(back_populates="ingredients")
    ingredient: Mapped["Ingredient"] = relationship(back_populates="recipe_ingredients")  # noqa: F821


class Step(Base):
    __tablename__ = "steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipe_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False
    )
    order: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    timer_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Nullable in v1 — automatic crop extraction is a future enhancement, not implemented
    image_crop_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    recipe: Mapped["Recipe"] = relationship(back_populates="steps")
