"""add expires_at to pantry_items

Revision ID: g7h8i9j0k1l2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-03 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "g7h8i9j0k1l2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pantry_items",
        sa.Column("expires_at", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pantry_items", "expires_at")
