"""
NormalizedAmount — a value object used throughout the system.

All pantry comparisons and match scoring operate on NormalizedAmount values,
never on raw quantity + unit strings directly.
"""
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class NormalizedAmount:
    quantity: Decimal
    unit: str          # always the canonical unit: g, ml, or "count"
    dimension: str     # "mass" | "volume" | "count" | "pack"

    def __add__(self, other: "NormalizedAmount") -> "NormalizedAmount":
        if self.dimension != other.dimension or self.unit != other.unit:
            raise ValueError(
                f"Cannot add NormalizedAmounts with different dimensions/units: "
                f"{self.dimension}/{self.unit} vs {other.dimension}/{other.unit}"
            )
        return NormalizedAmount(
            quantity=self.quantity + other.quantity,
            unit=self.unit,
            dimension=self.dimension,
        )

    def __sub__(self, other: "NormalizedAmount") -> "NormalizedAmount":
        if self.dimension != other.dimension or self.unit != other.unit:
            raise ValueError(
                f"Cannot subtract NormalizedAmounts with different dimensions/units: "
                f"{self.dimension}/{self.unit} vs {other.dimension}/{other.unit}"
            )
        return NormalizedAmount(
            quantity=self.quantity - other.quantity,
            unit=self.unit,
            dimension=self.dimension,
        )
