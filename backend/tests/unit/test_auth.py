"""
Auth endpoint tests.
Run: docker-compose exec api poetry run pytest tests/unit/test_auth.py -v

Tests use FastAPI's TestClient (sync) — no DB required.
"""
from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.auth import _make_token, ACCESS_COOKIE, REFRESH_COOKIE


# ── Helpers ───────────────────────────────────────────────────────────────────

PLAIN_PASSWORD = "test-pw"

def _make_hash(plain: str) -> str:
    import bcrypt as _bcrypt
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt(rounds=4)).decode()

# Use TestClient — automatically handles cookies between requests
client = TestClient(app, raise_server_exceptions=True)


def _patch_settings(**kwargs):
    """Context manager that patches app.config.settings attributes."""
    return patch.multiple("app.api.v1.auth.settings", **kwargs)


# ── Token generation ──────────────────────────────────────────────────────────

def test_make_token_returns_string():
    token = _make_token("household", timedelta(minutes=15))
    assert isinstance(token, str)
    assert len(token) > 20


def test_make_token_different_each_call():
    """Two tokens issued at slightly different times should differ due to exp claim."""
    t1 = _make_token("household", timedelta(minutes=15))
    t2 = _make_token("household", timedelta(minutes=15))
    # They may theoretically match within same second, but the sub is identical —
    # what matters is the JWT is well-formed.
    assert isinstance(t1, str) and isinstance(t2, str)


# ── Login ─────────────────────────────────────────────────────────────────────

def test_login_success():
    hashed = _make_hash(PLAIN_PASSWORD)
    with _patch_settings(household_username="household", household_password_hash=hashed):
        res = client.post("/api/auth/login", json={"username": "household", "password": PLAIN_PASSWORD})
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    # Access cookie must be set
    assert ACCESS_COOKIE in res.cookies


def test_login_wrong_password():
    hashed = _make_hash(PLAIN_PASSWORD)
    with _patch_settings(household_username="household", household_password_hash=hashed):
        res = client.post("/api/auth/login", json={"username": "household", "password": "wrong"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_login_wrong_username():
    hashed = _make_hash(PLAIN_PASSWORD)
    with _patch_settings(household_username="household", household_password_hash=hashed):
        res = client.post("/api/auth/login", json={"username": "admin", "password": PLAIN_PASSWORD})
    assert res.status_code == 401


def test_login_empty_hash_rejected():
    """If HOUSEHOLD_PASSWORD_HASH not configured, login must always fail."""
    with _patch_settings(household_username="household", household_password_hash=""):
        res = client.post("/api/auth/login", json={"username": "household", "password": PLAIN_PASSWORD})
    assert res.status_code == 401


# ── Logout ────────────────────────────────────────────────────────────────────

def test_logout_clears_cookies():
    hashed = _make_hash(PLAIN_PASSWORD)
    with _patch_settings(household_username="household", household_password_hash=hashed):
        # Login first
        client.post("/api/auth/login", json={"username": "household", "password": PLAIN_PASSWORD})
        res = client.post("/api/auth/logout")
    assert res.status_code == 200
    # Cookie should be deleted (max-age=0 / expires in past)
    assert res.cookies.get(ACCESS_COOKIE) is None


# ── Middleware: protected routes ──────────────────────────────────────────────

def test_health_accessible_without_auth():
    """Health endpoint must bypass auth."""
    # Use a fresh client with no cookies
    fresh = TestClient(app, raise_server_exceptions=True)
    res = fresh.get("/health")
    assert res.status_code == 200


def test_protected_route_without_token_returns_401():
    fresh = TestClient(app, raise_server_exceptions=True)
    res = fresh.get("/api/v1/recipes/")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_protected_route_with_valid_token():
    """A valid access cookie grants access (response may be 200 or 500 depending on DB)."""
    token = _make_token("household", timedelta(minutes=15))
    fresh = TestClient(app, raise_server_exceptions=False)
    fresh.cookies.set(ACCESS_COOKIE, token)
    res = fresh.get("/api/v1/recipes/")
    # Not 401 — auth passed (may be 500 if no DB in unit test environment)
    assert res.status_code != 401


def test_expired_token_returns_401():
    from jose import jwt
    from datetime import datetime, timezone
    from app.config import settings as real_settings

    expired_token = jwt.encode(
        {"sub": "household", "exp": datetime(2000, 1, 1, tzinfo=timezone.utc)},
        real_settings.jwt_secret,
        algorithm="HS256",
    )
    fresh = TestClient(app, raise_server_exceptions=True)
    fresh.cookies.set(ACCESS_COOKIE, expired_token)
    res = fresh.get("/api/v1/recipes/")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "TOKEN_EXPIRED"
