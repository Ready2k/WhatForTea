"""add household_id to pantry_items

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-04-26 20:00:00.000000
"""
import sqlalchemy as sa
from alembic import op

revision = "p6q7r8s9t0u1"
down_revision = "o5p6q7r8s9t0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add nullable first so existing rows are not immediately rejected
    op.add_column("pantry_items", sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))

    # Backfill: assign all existing pantry items to the first (oldest) household
    op.execute("""
        UPDATE pantry_items
        SET household_id = (SELECT id FROM households ORDER BY name LIMIT 1)
        WHERE household_id IS NULL
    """)

    # Now enforce NOT NULL
    op.alter_column("pantry_items", "household_id", nullable=False)

    # FK constraint
    op.create_foreign_key(
        "fk_pantry_items_household_id",
        "pantry_items", "households",
        ["household_id"], ["id"],
        ondelete="CASCADE",
    )

    # Unique constraint: one row per (ingredient, household)
    op.create_unique_constraint(
        "uq_pantry_item_ingredient_household",
        "pantry_items",
        ["ingredient_id", "household_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_pantry_item_ingredient_household", "pantry_items", type_="unique")
    op.drop_constraint("fk_pantry_items_household_id", "pantry_items", type_="foreignkey")
    op.drop_column("pantry_items", "household_id")
