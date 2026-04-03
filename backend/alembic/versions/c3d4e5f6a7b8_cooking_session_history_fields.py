"""cooking_session_history_fields

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-02

Adds cook history and rating fields to cooking_sessions:
  - confirmed_cook  — true when the user confirmed the session as a real cook
  - servings_cooked — how many portions were made
  - notes           — freeform cook notes
  - rating          — 1–5 star rating (nullable)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("cooking_sessions", sa.Column("confirmed_cook", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("cooking_sessions", sa.Column("servings_cooked", sa.SmallInteger(), nullable=True))
    op.add_column("cooking_sessions", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("cooking_sessions", sa.Column("rating", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("cooking_sessions", "rating")
    op.drop_column("cooking_sessions", "notes")
    op.drop_column("cooking_sessions", "servings_cooked")
    op.drop_column("cooking_sessions", "confirmed_cook")
