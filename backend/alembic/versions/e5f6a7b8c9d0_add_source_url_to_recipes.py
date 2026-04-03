"""add_source_url_to_recipes

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-03

Adds source_url (nullable) to recipes to store the origin URL for URL-imported recipes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("source_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "source_url")
