"""add shopping list items table

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-04-15 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "j0k1l2m3n4o5"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shopping_list_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("household_id", UUID(as_uuid=True), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("raw_name", sa.Text, nullable=False),
        sa.Column("quantity", sa.Float, nullable=False, server_default="1"),
        sa.Column("unit", sa.Text, nullable=False, server_default="count"),
        sa.Column("done", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("added_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_shopping_list_items_household_id", "shopping_list_items", ["household_id"])


def downgrade() -> None:
    op.drop_index("ix_shopping_list_items_household_id", table_name="shopping_list_items")
    op.drop_table("shopping_list_items")
