"""
Prometheus metrics definitions.

Exposed at GET /metrics via prometheus-fastapi-instrumentator.

Custom metrics:
  - ingestion_total          counter   labels: status=success|error
  - match_score_histogram    histogram recipe match scores (0–100)
  - pantry_item_count        gauge     current number of pantry items
"""
from prometheus_client import Counter, Gauge, Histogram

ingestion_total = Counter(
    "whatsfortea_ingestion_total",
    "Number of recipe ingestion jobs completed",
    labelnames=["status"],  # success | error
)

match_score_histogram = Histogram(
    "whatsfortea_match_score",
    "Distribution of recipe match scores (0–100)",
    buckets=[10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
)

pantry_item_count = Gauge(
    "whatsfortea_pantry_items",
    "Current number of items in the pantry",
)
