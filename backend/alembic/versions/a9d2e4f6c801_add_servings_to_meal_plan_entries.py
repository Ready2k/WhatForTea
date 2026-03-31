"""add_servings_to_meal_plan_entries

Revision ID: a9d2e4f6c801
Revises: 2bd943073a70
Create Date: 2026-03-31

Adds nullable `servings` column to meal_plan_entries.
NULL = use recipe.base_servings (backward compatible).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9d2e4f6c801"
down_revision: Union[str, None] = "2bd943073a70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "meal_plan_entries",
        sa.Column("servings", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("meal_plan_entries", "servings")
