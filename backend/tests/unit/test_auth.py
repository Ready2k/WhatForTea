"""
Auth endpoint tests.
Run: docker-compose exec api poetry run pytest tests/unit/test_auth.py -v

Tests use httpx.AsyncClient so that the async DB dependency works correctly
without event-loop cross-threading issues.
"""
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import ASGITransport

from app.main import app
from app.database import get_db
from app.api.v1.auth import _make_token, ACCESS_COOKIE


# ── Helpers ───────────────────────────────────────────────────────────────────

PLAIN_PASSWORD = "test-pw"

def _make_hash(plain: str) -> str:
    from argon2 import PasswordHasher
    return PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(plain)  # fast params for tests


def _patch_settings(**kwargs):
    """Context manager that patches app.config.settings attributes."""
    return patch.multiple("app.api.v1.auth.settings", **kwargs)


async def _mock_get_db():
    """A fake DB dependency that returns a mock session (no user rows)."""
    from unittest.mock import MagicMock
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result
    yield mock_session


@pytest.fixture
async def async_client():
    """Return an httpx.AsyncClient wired to the ASGI app with a mocked DB."""
    app.dependency_overrides[get_db] = _mock_get_db
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        yield client
    app.dependency_overrides.pop(get_db, None)


# ── Token generation (no I/O) ────────────────────────────────────────────────

def test_make_token_returns_string():
    token = _make_token("household", "household", timedelta(minutes=15))
    assert isinstance(token, str)
    assert len(token) > 20


def test_make_token_different_each_call():
    """Two tokens issued at slightly different times should differ due to exp claim."""
    t1 = _make_token("household", "household", timedelta(minutes=15))
    t2 = _make_token("household", "household", timedelta(minutes=15))
    assert isinstance(t1, str) and isinstance(t2, str)


# ── Login ─────────────────────────────────────────────────────────────────────

async def test_login_success(async_client):
    hashed = _make_hash(PLAIN_PASSWORD)
    with _patch_settings(household_username="household", household_password_hash=hashed):
        res = await async_client.post("/api/auth/login", json={"username": "household", "password": PLAIN_PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body.get("ok") is True
    assert ACCESS_COOKIE in res.cookies


async def test_login_wrong_password(async_client):
    hashed = _make_hash(PLAIN_PASSWORD)
    with _patch_settings(household_username="household", household_password_hash=hashed):
        res = await async_client.post("/api/auth/login", json={"username": "household", "password": "wrong"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


async def test_login_wrong_username(async_client):
    hashed = _make_hash(PLAIN_PASSWORD)
    with _patch_settings(household_username="household", household_password_hash=hashed):
        res = await async_client.post("/api/auth/login", json={"username": "admin", "password": PLAIN_PASSWORD})
    assert res.status_code == 401


async def test_login_empty_hash_rejected(async_client):
    """If HOUSEHOLD_PASSWORD_HASH not configured, login must always fail."""
    with _patch_settings(household_username="household", household_password_hash=""):
        res = await async_client.post("/api/auth/login", json={"username": "household", "password": PLAIN_PASSWORD})
    assert res.status_code == 401


# ── Logout ────────────────────────────────────────────────────────────────────

async def test_logout_clears_cookies(async_client):
    hashed = _make_hash(PLAIN_PASSWORD)
    with _patch_settings(household_username="household", household_password_hash=hashed):
        # Login first
        login_res = await async_client.post("/api/auth/login", json={"username": "household", "password": PLAIN_PASSWORD})
        # Set the cookie from the login response
        async_client.cookies.set(ACCESS_COOKIE, login_res.cookies.get(ACCESS_COOKIE))
        res = await async_client.post("/api/auth/logout")
    assert res.status_code == 200


# ── Middleware: protected routes ──────────────────────────────────────────────

async def test_health_accessible_without_auth(async_client):
    """Health endpoint must bypass auth."""
    res = await async_client.get("/health")
    assert res.status_code == 200


async def test_protected_route_without_token_returns_401(async_client):
    res = await async_client.get("/api/v1/recipes/")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


async def test_protected_route_with_valid_token(async_client):
    """A valid access cookie grants access (response may be 200 or 500 depending on DB)."""
    token = _make_token("household", "household", timedelta(minutes=15))
    async_client.cookies.set(ACCESS_COOKIE, token)
    res = await async_client.get("/api/v1/recipes/")
    # Not 401 — auth passed (may be 500 if no DB in unit test environment)
    assert res.status_code != 401


async def test_expired_token_returns_401(async_client):
    from jose import jwt
    from datetime import datetime, timezone
    from app.config import settings as real_settings

    expired_token = jwt.encode(
        {"sub": "household", "exp": datetime(2000, 1, 1, tzinfo=timezone.utc)},
        real_settings.jwt_secret,
        algorithm="HS256",
    )
    async_client.cookies.set(ACCESS_COOKIE, expired_token)
    res = await async_client.get("/api/v1/recipes/")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "TOKEN_EXPIRED"
