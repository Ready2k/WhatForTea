from typing import Literal, Optional
from pydantic import BaseModel


class BarcodeLookupRequest(BaseModel):
    barcode: str


class BarcodeLookupResponse(BaseModel):
    barcode: str
    product_name: Optional[str] = None
    ingredient_id: Optional[str] = None
    canonical_name: Optional[str] = None
    confidence: float = 0.0
    # cache: served from Redis cache
    # openfoodfacts: fresh lookup from Open Food Facts
    # not_found: barcode exists but no usable product name
    # unresolved: product name found but normaliser couldn't match an ingredient
    # error: network or parse error
    source: Literal["cache", "openfoodfacts", "not_found", "unresolved", "error"]
    error: Optional[str] = None
