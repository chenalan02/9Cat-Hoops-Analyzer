import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.core.exceptions import AppError
from backend.core.logging import logger
from backend.schemas.error import ErrorDetail, ErrorResponse

_HTTP_STATUS_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_SERVER_ERROR",
    502: "BAD_GATEWAY",
    503: "SERVICE_UNAVAILABLE",
}


def build_error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    request_id: str | None = None,
    details: Any = None,
) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorDetail(
            code=code,
            message=message,
            status=status_code,
            details=details,
            request_id=request_id,
        )
    )
    headers = {"X-Request-ID": request_id} if request_id else None
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(payload.model_dump(exclude_none=True)),
        headers=headers,
    )


def _format_validation_message(exc: RequestValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "Request validation failed."
    first = errors[0]
    loc_parts = [str(part) for part in first.get("loc", ()) if part != "body"]
    msg = first.get("msg", "Invalid value")
    if loc_parts:
        return f"{'.'.join(loc_parts)}: {msg}"
    return msg


async def error_handling_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except AppError as exc:
        return build_error_response(
            exc.status_code,
            exc.code,
            exc.message,
            request_id=request_id,
            details=exc.details,
        )
    except Exception:
        logger.exception("Unhandled server exception [request_id=%s]", request_id)
        return build_error_response(
            500,
            "INTERNAL_SERVER_ERROR",
            "An unexpected internal error occurred.",
            request_id=request_id,
        )

    response.headers["X-Request-ID"] = request_id
    return response


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return build_error_response(
            exc.status_code,
            exc.code,
            exc.message,
            request_id=request_id,
            details=exc.details,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return build_error_response(
            422,
            "VALIDATION_ERROR",
            _format_validation_message(exc),
            request_id=request_id,
            details=exc.errors(),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        code = _HTTP_STATUS_CODES.get(exc.status_code, "HTTP_ERROR")
        return build_error_response(
            exc.status_code,
            code,
            str(exc.detail),
            request_id=request_id,
        )
