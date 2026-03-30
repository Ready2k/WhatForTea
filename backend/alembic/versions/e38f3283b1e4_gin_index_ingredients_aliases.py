"""gin_index_ingredients_aliases

Revision ID: e38f3283b1e4
Revises: 5067703d24c7
Create Date: 2026-03-30 21:27:13.719595

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e38f3283b1e4'
down_revision: Union[str, None] = '5067703d24c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # GIN index enables efficient array containment queries on aliases
    op.execute(
        "CREATE INDEX ix_ingredients_aliases_gin ON ingredients USING gin(aliases)"
    )
    # Also index canonical_name for fast case-insensitive lookups
    op.execute(
        "CREATE INDEX ix_ingredients_canonical_name_lower ON ingredients (lower(canonical_name))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ingredients_aliases_gin")
    op.execute("DROP INDEX IF EXISTS ix_ingredients_canonical_name_lower")
