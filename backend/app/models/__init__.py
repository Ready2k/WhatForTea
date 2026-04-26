"""
Import all ORM models here so that:
1. Alembic can detect them for autogenerate (imported by alembic/env.py)
2. SQLAlchemy relationships can resolve forward references at startup
"""
from app.models.ingredient import Ingredient, IngredientCategory, IngredientDimension, IngredientSubstitute, UnitConversion
from app.models.recipe import Recipe, RecipeIngredient, SourceType, Step
from app.models.pantry import PantryItem, PantryReservation, ReservationType
from app.models.plan import MealPlan, MealPlanEntry
from app.models.session import CookingSession
from app.models.ingest import IngestJob, IngestSourceType, IngestStatus, LlmOutput
from app.models.collection import Collection, recipe_collections
from app.models.user import Household, User
from app.models.normalised_amount import NormalizedAmount
from app.models.push import PushSubscription

__all__ = [
    "Ingredient",
    "IngredientCategory",
    "IngredientDimension",
    "IngredientSubstitute",
    "UnitConversion",
    "Recipe",
    "RecipeIngredient",
    "SourceType",
    "Step",
    "PantryItem",
    "PantryReservation",
    "ReservationType",
    "MealPlan",
    "MealPlanEntry",
    "CookingSession",
    "IngestJob",
    "IngestSourceType",
    "IngestStatus",
    "LlmOutput",
    "NormalizedAmount",
    "Collection",
    "recipe_collections",
    "Household",
    "User",
    "PushSubscription",
]
