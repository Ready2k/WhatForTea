"""add_image_fingerprint_to_recipes

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-02

Adds image_fingerprint (perceptual hash string) to recipes for duplicate detection.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("image_fingerprint", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "image_fingerprint")
