from contextlib import asynccontextmanager

import pytz
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from backend.api.error_handler import error_handling_middleware, register_exception_handlers
from backend.api.routes import v1_router
from backend.core.config import Settings, get_settings
from backend.services.databricks_store import refresh_databricks_cache


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()

    @asynccontextmanager
    async def lifespan(fastapi_app: FastAPI):
        refresh_databricks_cache(fastapi_app.state, cfg)

        eastern = pytz.timezone(cfg.refresh_timezone)
        scheduler = BackgroundScheduler(timezone=eastern)
        scheduler.add_job(
            refresh_databricks_cache,
            "cron",
            hour=cfg.refresh_hour,
            minute=cfg.refresh_minute,
            args=[fastapi_app.state, cfg],
        )
        scheduler.start()
        try:
            yield
        finally:
            scheduler.shutdown()

    application = FastAPI(title=cfg.app_title, lifespan=lifespan)

    # Add CORSMiddleware last so error responses pass back through it and include CORS headers.
    application.add_middleware(BaseHTTPMiddleware, dispatch=error_handling_middleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(application)

    @application.get("/", tags=["root"])
    def root() -> dict[str, str]:
        return {
            "name": cfg.app_title,
            "version": "v1",
            "docs": "/docs",
        }

    application.include_router(v1_router)
    return application


app = create_app()
