"""seed_unit_conversions

Revision ID: 5067703d24c7
Revises: b65776dded38
Create Date: 2026-03-30 21:22:51.591827

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5067703d24c7'
down_revision: Union[str, None] = 'b65776dded38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# fmt: off
CONVERSIONS = [
    # Volume
    ("tbsp",  "ml",    15.0),
    ("ml",    "tbsp",  1 / 15.0),
    ("tsp",   "ml",    5.0),
    ("ml",    "tsp",   1 / 5.0),
    ("l",     "ml",    1000.0),
    ("ml",    "l",     0.001),
    ("fl oz", "ml",    29.5735),
    ("ml",    "fl oz", 1 / 29.5735),
    ("cup",   "ml",    240.0),
    ("ml",    "cup",   1 / 240.0),
    # Mass
    ("kg",    "g",     1000.0),
    ("g",     "kg",    0.001),
    ("oz",    "g",     28.3495),
    ("g",     "oz",    1 / 28.3495),
    ("lb",    "g",     453.592),
    ("g",     "lb",    1 / 453.592),
]
# fmt: on


def upgrade() -> None:
    unit_conversions = sa.table(
        "unit_conversions",
        sa.column("from_unit", sa.Text),
        sa.column("to_unit", sa.Text),
        sa.column("factor", sa.Numeric),
    )
    op.bulk_insert(unit_conversions, [
        {"from_unit": f, "to_unit": t, "factor": factor}
        for f, t, factor in CONVERSIONS
    ])


def downgrade() -> None:
    op.execute("DELETE FROM unit_conversions")
