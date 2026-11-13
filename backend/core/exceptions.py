from typing import Any


class AppError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 500,
        code: str = "INTERNAL_SERVER_ERROR",
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details


class BadRequestError(AppError):
    def __init__(self, message: str, *, code: str = "BAD_REQUEST", details: Any = None) -> None:
        super().__init__(message, status_code=400, code=code, details=details)


class NotFoundError(AppError):
    def __init__(self, message: str, *, code: str = "NOT_FOUND", details: Any = None) -> None:
        super().__init__(message, status_code=404, code=code, details=details)


class UpstreamServiceError(AppError):
    def __init__(self, message: str, *, code: str = "UPSTREAM_ERROR", details: Any = None) -> None:
        super().__init__(message, status_code=502, code=code, details=details)


class ServiceUnavailableError(AppError):
    def __init__(self, message: str, *, code: str = "SERVICE_UNAVAILABLE", details: Any = None) -> None:
        super().__init__(message, status_code=503, code=code, details=details)
