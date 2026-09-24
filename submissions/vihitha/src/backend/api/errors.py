"""Typed service errors and the single handler that maps them to ErrorBody."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ServiceError(Exception):
    status = 500
    code = "INTERNAL"

    def __init__(self, message: str, details=None):
        super().__init__(message)
        self.message = message
        self.details = details


class NotFound(ServiceError):
    status, code = 404, "NOT_FOUND"


class ValidationFailed(ServiceError):
    status, code = 422, "VALIDATION_FAILED"


class Conflict(ServiceError):
    status, code = 409, "CONFLICT"


def _body(code: str, message: str, details=None) -> dict:
    return {"error": {"code": code, "message": message, "details": details}}


def install(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def _service(_: Request, exc: ServiceError):
        return JSONResponse(status_code=exc.status, content=_body(exc.code, exc.message, exc.details))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errs = [{"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in exc.errors()]
        return JSONResponse(status_code=422, content=_body("VALIDATION_FAILED", "Invalid request", errs))

    @app.exception_handler(Exception)
    async def _internal(_: Request, exc: Exception):
        return JSONResponse(status_code=500, content=_body("INTERNAL", str(exc) or exc.__class__.__name__))
