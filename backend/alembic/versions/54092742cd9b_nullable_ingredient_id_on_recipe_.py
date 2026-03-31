"""nullable_ingredient_id_on_recipe_ingredients

Revision ID: 54092742cd9b
Revises: a9d2e4f6c801
Create Date: 2026-03-31 21:29:11.310966

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '54092742cd9b'
down_revision: Union[str, None] = 'a9d2e4f6c801'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('recipe_ingredients', 'ingredient_id',
               existing_type=sa.UUID(),
               nullable=True)


def downgrade() -> None:
    op.alter_column('recipe_ingredients', 'ingredient_id',
               existing_type=sa.UUID(),
               nullable=False)
