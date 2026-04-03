"""add_nutrition_estimate_to_recipes

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-03

Adds nutrition_estimate (JSONB, nullable) and nutrition_estimated_at (timestamp, nullable) to recipes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("nutrition_estimate", JSONB(), nullable=True))
    op.add_column("recipes", sa.Column("nutrition_estimated_at", TIMESTAMP(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "nutrition_estimated_at")
    op.drop_column("recipes", "nutrition_estimate")
