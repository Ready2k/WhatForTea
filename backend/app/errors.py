"""
Central error codes and FastAPI exception handlers.

All API errors return:
  { "error": { "code": "SCREAMING_SNAKE_CASE", "message": "...", "details": {...} } }
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


# ── Error codes ───────────────────────────────────────────────────────────────

class ErrorCode:
    # Ingredient / normaliser
    INGREDIENT_UNRESOLVED = "INGREDIENT_UNRESOLVED"
    INGREDIENT_NOT_FOUND = "INGREDIENT_NOT_FOUND"

    # Ingestion
    INGEST_JOB_NOT_FOUND = "INGEST_JOB_NOT_FOUND"
    INGEST_VALIDATION_FAILED = "INGEST_VALIDATION_FAILED"
    LLM_RATE_LIMIT_EXCEEDED = "LLM_RATE_LIMIT_EXCEEDED"
    LLM_CALL_FAILED = "LLM_CALL_FAILED"

    # Auth
    UNAUTHORIZED = "UNAUTHORIZED"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"

    # Generic
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


# ── Exception base class ──────────────────────────────────────────────────────

class AppError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, details: dict | None = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


# ── Register handlers ─────────────────────────────────────────────────────────

def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        )
