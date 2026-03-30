"""seed_canonical_ingredients

Revision ID: 2bd943073a70
Revises: e38f3283b1e4
Create Date: 2026-03-30

Seeds the canonical ingredient list with common HelloFresh ingredients and their aliases.
Add new ingredients here (or via the admin API) as more cards are ingested.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '2bd943073a70'
down_revision: Union[str, None] = 'e38f3283b1e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# fmt: off
# (canonical_name, category, dimension, typical_unit, count_to_mass_g, aliases)
INGREDIENTS = [
    # ── Alliums ───────────────────────────────────────────────────────────────
    ("Shallot",         "produce", "count", "count", 30,   ["Echalion Shallot", "Shallots", "shallot"]),
    ("Onion",           "produce", "count", "count", 150,  ["Brown Onion", "White Onion", "onion", "onions"]),
    ("Red Onion",       "produce", "count", "count", 150,  ["red onion", "red onions"]),
    ("Spring Onion",    "produce", "count", "count", 15,   ["spring onion", "scallion", "green onion"]),
    ("Garlic",          "produce", "count", "count", 5,    ["Garlic Clove", "Garlic cloves", "garlic clove", "garlic"]),
    # ── Meat ──────────────────────────────────────────────────────────────────
    ("Chicken Breast",  "meat",    "mass",  "g",     None, ["British Chicken Breast", "Chicken breast fillets", "chicken breast"]),
    ("Beef Mince",      "meat",    "mass",  "g",     None, ["British beef mince", "beef mince", "minced beef"]),
    ("Pork Mince",      "meat",    "mass",  "g",     None, ["pork mince", "minced pork"]),
    ("Bacon",           "meat",    "mass",  "g",     None, ["Streaky Bacon", "Back Bacon", "bacon rashers", "bacon"]),
    ("Bacon Lardons",   "meat",    "mass",  "g",     None, ["Smoked Bacon Lardons", "lardons", "bacon lardons"]),
    # ── Dairy ─────────────────────────────────────────────────────────────────
    ("Butter",          "dairy",   "mass",  "g",     None, ["Salted Butter", "Unsalted Butter", "butter"]),
    ("Sour Cream",      "dairy",   "volume","ml",    None, ["Soured Cream", "sour cream", "Sour cream"]),
    ("Double Cream",    "dairy",   "volume","ml",    None, ["double cream", "heavy cream"]),
    ("Crème Fraîche",   "dairy",   "volume","ml",    None, ["Creme fraiche", "creme fraiche", "crème fraîche"]),
    ("Cheddar",         "dairy",   "mass",  "g",     None, ["Mature Cheddar Cheese", "Grated Cheddar", "cheddar cheese", "cheddar"]),
    ("Parmesan",        "dairy",   "mass",  "g",     None, ["Hard Italian Cheese", "Parmesan cheese", "parmesan", "parmigiano"]),
    ("Feta",            "dairy",   "mass",  "g",     None, ["Feta Cheese", "feta cheese", "feta"]),
    # ── Produce ───────────────────────────────────────────────────────────────
    ("Cherry Tomatoes", "produce", "mass",  "g",     10,   ["Baby Plum Tomatoes", "cherry tomatoes", "cherry toms"]),
    ("Tomato",          "produce", "count", "count", 120,  ["Vine Tomatoes", "tomato", "tomatoes"]),
    ("Courgette",       "produce", "count", "count", 200,  ["courgette", "zucchini"]),
    ("Aubergine",       "produce", "count", "count", 300,  ["aubergine", "eggplant"]),
    ("Red Pepper",      "produce", "count", "count", 160,  ["red pepper", "red capsicum"]),
    ("Yellow Pepper",   "produce", "count", "count", 160,  ["yellow pepper", "yellow capsicum"]),
    ("Spinach",         "produce", "mass",  "g",     None, ["Baby Spinach", "Fresh Spinach", "spinach"]),
    ("Potato",          "produce", "mass",  "g",     None, ["Baking Potato", "Charlotte Potatoes", "New Potatoes", "potatoes", "potato"]),
    ("Lemon",           "produce", "count", "count", 100,  ["lemon", "lemons"]),
    ("Lime",            "produce", "count", "count", 70,   ["lime", "limes"]),
    # ── Pantry ────────────────────────────────────────────────────────────────
    ("Pasta",           "pantry",  "mass",  "g",     None, ["Dried Pasta", "Penne pasta", "Spaghetti", "pasta", "tagliatelle", "fusilli", "rigatoni"]),
    ("Rice",            "pantry",  "mass",  "g",     None, ["Long Grain Rice", "Basmati Rice", "rice"]),
    ("Flour",           "pantry",  "mass",  "g",     None, ["Plain Flour", "Self Raising Flour", "flour"]),
    ("Olive Oil",       "pantry",  "volume","ml",    None, ["Extra Virgin Olive Oil", "olive oil"]),
    ("Tomato Purée",    "pantry",  "volume","ml",    None, ["Tomato Puree", "tomato paste", "tomato puree", "tomato purée"]),
    ("Chicken Stock",   "pantry",  "volume","ml",    None, ["Chicken Stock Pot", "chicken stock", "chicken broth"]),
    ("Beef Stock",      "pantry",  "volume","ml",    None, ["Beef Stock Pot", "beef stock", "beef broth"]),
    ("Vegetable Stock", "pantry",  "volume","ml",    None, ["Vegetable Stock Pot", "vegetable stock", "veg stock"]),
]
# fmt: on


def upgrade() -> None:
    ingredients_table = sa.table(
        "ingredients",
        sa.column("id", sa.Text),
        sa.column("canonical_name", sa.Text),
        sa.column("aliases", sa.ARRAY(sa.Text)),
        sa.column("category", sa.Text),
        sa.column("dimension", sa.Text),
        sa.column("typical_unit", sa.Text),
        sa.column("count_to_mass_g", sa.Numeric),
    )

    rows = []
    for canonical_name, category, dimension, typical_unit, count_to_mass_g, aliases in INGREDIENTS:
        rows.append({
            "id": sa.text("gen_random_uuid()"),
            "canonical_name": canonical_name,
            "aliases": aliases,
            "category": category.upper(),
            "dimension": dimension.upper(),
            "typical_unit": typical_unit,
            "count_to_mass_g": count_to_mass_g,
        })

    # Insert one at a time to use gen_random_uuid() server-side
    conn = op.get_bind()
    for row in rows:
        conn.execute(
            sa.text(
                "INSERT INTO ingredients (id, canonical_name, aliases, category, dimension, typical_unit, count_to_mass_g) "
                "VALUES (gen_random_uuid(), :canonical_name, :aliases, :category, :dimension, :typical_unit, :count_to_mass_g) "
                "ON CONFLICT (canonical_name) DO NOTHING"
            ),
            {
                "canonical_name": row["canonical_name"],
                "aliases": row["aliases"],
                "category": row["category"],
                "dimension": row["dimension"],
                "typical_unit": row["typical_unit"],
                "count_to_mass_g": row["count_to_mass_g"],
            },
        )


def downgrade() -> None:
    canonical_names = [name for name, *_ in INGREDIENTS]
    op.execute(
        sa.text("DELETE FROM ingredients WHERE canonical_name = ANY(:names)").bindparams(
            names=canonical_names
        )
    )
