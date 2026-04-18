"""normalise existing mood_tags to lowercase deduplicated

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-04-18 14:00:00.000000
"""
from alembic import op

revision = "m3n4o5p6q7r8"
down_revision = "l2m3n4o5p6q7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # For each recipe, rebuild mood_tags as lowercase + deduplicated.
    # ARRAY(SELECT DISTINCT lower(trim(t)) ...) preserves only unique lowercased values.
    op.execute("""
        UPDATE recipes
        SET mood_tags = (
            SELECT ARRAY(
                SELECT DISTINCT lower(trim(t))
                FROM unnest(mood_tags) AS t
                WHERE trim(t) <> ''
                ORDER BY lower(trim(t))
            )
        )
        WHERE mood_tags IS NOT NULL
          AND array_length(mood_tags, 1) > 0
    """)


def downgrade() -> None:
    pass  # data change — cannot reverse
