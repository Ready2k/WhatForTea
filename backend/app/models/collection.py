import uuid
from datetime import datetime

from sqlalchemy import Column, ForeignKey, Table, Text, func
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# ── Association table ─────────────────────────────────────────────────────────
recipe_collections = Table(
    "recipe_collections",
    Base.metadata,
    Column(
        "collection_id",
        UUID(as_uuid=True),
        ForeignKey("collections.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "recipe_id",
        UUID(as_uuid=True),
        ForeignKey("recipes.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "added_at",
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    ),
)


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    colour: Mapped[str] = mapped_column(Text, nullable=False, default="#10b981")
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )

    # Many-to-many relationship to Recipe
    recipes: Mapped[list["Recipe"]] = relationship(  # noqa: F821
        "Recipe",
        secondary=recipe_collections,
        back_populates="collections",
    )
