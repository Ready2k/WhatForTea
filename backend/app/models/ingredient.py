import enum
import uuid
from typing import Optional

from sqlalchemy import Enum, ForeignKey, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class IngredientCategory(str, enum.Enum):
    PRODUCE = "produce"
    DAIRY = "dairy"
    MEAT = "meat"
    FISH = "fish"
    PANTRY = "pantry"
    SPICE = "spice"
    BAKERY = "bakery"
    OTHER = "other"


class IngredientDimension(str, enum.Enum):
    MASS = "mass"
    VOLUME = "volume"
    COUNT = "count"
    PACK = "pack"


class Ingredient(Base):
    __tablename__ = "ingredients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    canonical_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    aliases: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    category: Mapped[IngredientCategory] = mapped_column(
        Enum(IngredientCategory, name="ingredient_category"), nullable=False
    )
    dimension: Mapped[IngredientDimension] = mapped_column(
        Enum(IngredientDimension, name="ingredient_dimension"), nullable=False
    )
    typical_unit: Mapped[str] = mapped_column(Text, nullable=False)
    # Heuristic for count ↔ mass conversion: 1 onion ≈ 150 g
    count_to_mass_g: Mapped[Optional[float]] = mapped_column(Numeric(10, 3), nullable=True)

    # Relationships
    recipe_ingredients: Mapped[list["RecipeIngredient"]] = relationship(  # noqa: F821
        back_populates="ingredient"
    )
    pantry_items: Mapped[list["PantryItem"]] = relationship(  # noqa: F821
        back_populates="ingredient"
    )
    substitutes_from: Mapped[list["IngredientSubstitute"]] = relationship(  # noqa: F821
        foreign_keys="IngredientSubstitute.ingredient_id", back_populates="ingredient"
    )
    substitutes_to: Mapped[list["IngredientSubstitute"]] = relationship(  # noqa: F821
        foreign_keys="IngredientSubstitute.substitute_ingredient_id",
        back_populates="substitute_ingredient",
    )


class UnitConversion(Base):
    """
    Global conversion graph for unit normalisation.
    Mass ↔ mass and volume ↔ volume conversions are universal.
    Multiply `from_unit` × factor to get `to_unit`.
    """
    __tablename__ = "unit_conversions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    from_unit: Mapped[str] = mapped_column(Text, nullable=False)
    to_unit: Mapped[str] = mapped_column(Text, nullable=False)
    factor: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)

    __table_args__ = (UniqueConstraint("from_unit", "to_unit", name="uq_unit_conversion"),)


class IngredientSubstitute(Base):
    """
    Known ingredient substitutions. Defined in schema now; not used by v1 matching logic.
    """
    __tablename__ = "ingredient_substitutes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ingredients.id", ondelete="CASCADE"), nullable=False
    )
    substitute_ingredient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ingredients.id", ondelete="CASCADE"), nullable=False
    )
    equivalence_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 0 = perfect substitute, 1 = poor substitute
    penalty_score: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False, default=0.0)

    # Relationships
    ingredient: Mapped["Ingredient"] = relationship(
        foreign_keys=[ingredient_id], back_populates="substitutes_from"
    )
    substitute_ingredient: Mapped["Ingredient"] = relationship(
        foreign_keys=[substitute_ingredient_id], back_populates="substitutes_to"
    )
