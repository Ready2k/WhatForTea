"""
Phase 10 — Additional coverage tests.

Focuses on boundary conditions and edge cases across the three
critical-path algorithms: match scoring, pantry decay, and shopping
list pack-size rounding.

Run: docker-compose exec api poetry run pytest tests/unit/test_phase10.py -v
"""
from datetime import datetime, timedelta, timezone

import pytest

# ─────────────────────────────────────────────────────────────────────────────
# Match score algorithm — boundary conditions
# ─────────────────────────────────────────────────────────────────────────────

from app.services.matcher import ingredient_score, get_category
from app.services.pantry import calculate_confidence
from app.services.planner import round_to_pack_size


class TestIngredientScore:
    def test_exactly_enough(self):
        assert ingredient_score(100.0, 100.0) == 1.0

    def test_more_than_enough_capped_at_one(self):
        assert ingredient_score(200.0, 100.0) == 1.0

    def test_half_available(self):
        assert ingredient_score(50.0, 100.0) == pytest.approx(0.5)

    def test_nothing_available(self):
        assert ingredient_score(0.0, 100.0) == 0.0

    def test_required_zero_returns_zero(self):
        """Guard against division by zero."""
        assert ingredient_score(50.0, 0.0) == 0.0

    def test_both_zero_returns_zero(self):
        assert ingredient_score(0.0, 0.0) == 0.0

    def test_fractional_quantities(self):
        assert ingredient_score(0.25, 1.0) == pytest.approx(0.25)

    def test_tiny_amount_available(self):
        assert ingredient_score(0.001, 100.0) == pytest.approx(0.00001)


class TestGetCategory:
    def test_exactly_90_is_cook_now(self):
        assert get_category(90.0) == "cook_now"

    def test_100_is_cook_now(self):
        assert get_category(100.0) == "cook_now"

    def test_89_9_is_almost_there(self):
        assert get_category(89.9) == "almost_there"

    def test_exactly_50_is_almost_there(self):
        assert get_category(50.0) == "almost_there"

    def test_49_9_is_planner(self):
        assert get_category(49.9) == "planner"

    def test_zero_is_planner(self):
        assert get_category(0.0) == "planner"

    def test_boundary_at_90_inclusive(self):
        assert get_category(90.0) == "cook_now"
        assert get_category(90.1) == "cook_now"

    def test_boundary_at_50_inclusive(self):
        assert get_category(50.0) == "almost_there"
        assert get_category(50.1) == "almost_there"


# ─────────────────────────────────────────────────────────────────────────────
# Pantry decay — time-simulated scenarios
# ─────────────────────────────────────────────────────────────────────────────



class TestPantryDecay:
    def _now(self):
        return datetime.now(timezone.utc)

    def test_zero_days_full_confidence(self):
        now = self._now()
        assert calculate_confidence(0.1, now, now) == pytest.approx(1.0)

    def test_ten_days_fridge_item(self):
        """Fridge decay 0.1/day → 10 days = 0.0 confidence."""
        now = self._now()
        confirmed = now - timedelta(days=10)
        assert calculate_confidence(0.1, confirmed, now) == pytest.approx(0.0)

    def test_five_days_fridge_item(self):
        now = self._now()
        confirmed = now - timedelta(days=5)
        assert calculate_confidence(0.1, confirmed, now) == pytest.approx(0.5)

    def test_confidence_never_goes_negative(self):
        now = self._now()
        confirmed = now - timedelta(days=100)
        assert calculate_confidence(0.1, confirmed, now) == 0.0

    def test_confidence_never_exceeds_one(self):
        """Future confirmation timestamp (clock drift) should clamp to 1.0."""
        now = self._now()
        future = now + timedelta(seconds=5)
        assert calculate_confidence(0.1, future, now) == 1.0

    def test_slow_pantry_decay(self):
        """Pantry item 0.02/day → 25 days = 0.5 confidence."""
        now = self._now()
        confirmed = now - timedelta(days=25)
        assert calculate_confidence(0.02, confirmed, now) == pytest.approx(0.5)

    def test_zero_decay_rate_always_full(self):
        """Items with decay_rate=0 never lose confidence."""
        now = self._now()
        confirmed = now - timedelta(days=365)
        assert calculate_confidence(0.0, confirmed, now) == pytest.approx(1.0)

    def test_idempotent_on_replay(self):
        """Running decay twice with the same now should give the same result."""
        now = self._now()
        confirmed = now - timedelta(days=3)
        r1 = calculate_confidence(0.1, confirmed, now)
        r2 = calculate_confidence(0.1, confirmed, now)
        assert r1 == r2

    def test_naive_datetime_handled(self):
        """Naive (tz-unaware) last_confirmed_at must not raise."""
        now = datetime.now(timezone.utc)
        naive = datetime.utcnow()
        result = calculate_confidence(0.02, naive, now)
        assert 0.0 <= result <= 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Shopping list pack-size rounding — edge cases
# ─────────────────────────────────────────────────────────────────────────────



class TestPackSizeRounding:
    def test_zero_required_returns_zero(self):
        assert round_to_pack_size(0.0, "onion", "count") == 0.0

    def test_negative_required_returns_zero(self):
        assert round_to_pack_size(-5.0, "onion", "count") == 0.0

    def test_exact_pack_size(self):
        """250g of butter → one 250g pack."""
        result = round_to_pack_size(250.0, "butter", "g")
        assert result == pytest.approx(250.0)

    def test_rounds_up_not_down(self):
        """1g of butter should round up to the smallest pack, not zero."""
        result = round_to_pack_size(1.0, "butter", "g")
        assert result > 0.0

    def test_over_largest_pack_returns_required(self):
        """Requesting more than the largest pack → return as-is (buy in bulk)."""
        result = round_to_pack_size(10_000.0, "butter", "g")
        assert result == pytest.approx(10_000.0)

    def test_half_unit_rounds_up(self):
        """0.5 of a count item should round up to 1."""
        result = round_to_pack_size(0.5, "egg", "count")
        assert result >= 1.0

    def test_unknown_ingredient_uses_unit_default(self):
        """An ingredient not in pack_sizes.yaml should fall through to a unit default."""
        result = round_to_pack_size(150.0, "zorblax_spice_xyz", "g")
        assert result >= 150.0  # at minimum returns the required amount

    def test_unknown_ingredient_unknown_unit_returns_required(self):
        result = round_to_pack_size(3.0, "zorblax_spice_xyz", "zorblax_unit")
        assert result == pytest.approx(3.0)
