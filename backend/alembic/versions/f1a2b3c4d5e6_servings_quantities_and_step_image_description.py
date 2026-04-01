"""Add servings_quantities to recipe_ingredients and image_description to steps

Revision ID: f1a2b3c4d5e6
Revises: a9d2e4f6c801
Create Date: 2026-04-01 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'f1a2b3c4d5e6'
down_revision = '54092742cd9b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('recipe_ingredients',
        sa.Column('servings_quantities', postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column('steps',
        sa.Column('image_description', sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('steps', 'image_description')
    op.drop_column('recipe_ingredients', 'servings_quantities')
