"""seed_ingredient_substitutes

Revision ID: b2c3d4e5f6a7
Revises: f1a2b3c4d5e6
Create Date: 2026-04-02

Seeds the ingredient_substitutes table with common household substitutions.
All inserts are safe to replay — they skip pairs that already exist.
penalty_score: 0 = perfect substitute, 1 = poor substitute.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (ingredient_canonical_name, substitute_canonical_name, equivalence_note, penalty_score)
SUBSTITUTES = [
    # Stock swaps — very common, low penalty
    ("Chicken Stock",   "Vegetable Stock", "Vegetable stock works in most chicken-based dishes; lighter flavour", 0.10),
    ("Beef Stock",      "Vegetable Stock", "Vegetable stock is a lighter substitute; less umami depth",            0.15),
    ("Vegetable Stock", "Chicken Stock",   "Chicken stock adds more body; suitable unless dish is vegetarian",    0.10),
    # Cream/dairy swaps
    ("Double Cream",    "Crème Fraîche",   "Slightly tangier; use 1:1 — reduces well",                           0.15),
    ("Crème Fraîche",   "Sour Cream",      "Very similar texture and tang; use 1:1",                             0.10),
    ("Sour Cream",      "Crème Fraîche",   "Very similar texture and tang; use 1:1",                             0.10),
    # Hard cheese swaps
    ("Parmesan",        "Cheddar",         "Stronger cheddar works in baked dishes; less nutty flavour",          0.30),
]


def upgrade() -> None:
    conn = op.get_bind()
    for ingredient_name, substitute_name, note, penalty in SUBSTITUTES:
        conn.execute(
            sa.text("""
                INSERT INTO ingredient_substitutes
                    (id, ingredient_id, substitute_ingredient_id, equivalence_note, penalty_score)
                SELECT
                    gen_random_uuid(),
                    i.id,
                    s.id,
                    :note,
                    :penalty
                FROM ingredients i, ingredients s
                WHERE i.canonical_name = :ingredient
                  AND s.canonical_name = :substitute
                  AND NOT EXISTS (
                    SELECT 1 FROM ingredient_substitutes x
                    WHERE x.ingredient_id = i.id
                      AND x.substitute_ingredient_id = s.id
                  )
            """),
            {
                "ingredient": ingredient_name,
                "substitute": substitute_name,
                "note": note,
                "penalty": penalty,
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    for ingredient_name, substitute_name, _, _ in SUBSTITUTES:
        conn.execute(
            sa.text("""
                DELETE FROM ingredient_substitutes
                WHERE ingredient_id = (SELECT id FROM ingredients WHERE canonical_name = :ingredient)
                  AND substitute_ingredient_id = (SELECT id FROM ingredients WHERE canonical_name = :substitute)
            """),
            {"ingredient": ingredient_name, "substitute": substitute_name},
        )
