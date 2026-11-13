import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_DOCKER_AUTH_DIR = Path("/app/auth")

_DEFAULT_CORS_ORIGINS = (
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


def _resolve_yahoo_auth_dir() -> Path:
    configured = os.getenv("YAHOO_AUTH_DIR")
    if configured:
        return Path(configured)
    if _DOCKER_AUTH_DIR.exists():
        return _DOCKER_AUTH_DIR
    return _PROJECT_ROOT / "yahoo_auth"


def _parse_cors_origins() -> tuple[str, ...]:
    raw = os.getenv("CORS_ORIGINS", "")
    if not raw.strip():
        return _DEFAULT_CORS_ORIGINS
    return tuple(origin.strip() for origin in raw.split(",") if origin.strip())


@dataclass(frozen=True)
class Settings:
    app_title: str = "9Cat Hoops Analyzer API"
    api_v1_prefix: str = "/v1"
    databricks_url: str | None = None
    databricks_http_path: str | None = None
    databricks_token: str | None = None
    yahoo_consumer_key: str | None = None
    yahoo_consumer_secret: str | None = None
    yahoo_auth_dir: Path = _DOCKER_AUTH_DIR
    cors_origins: tuple[str, ...] = _DEFAULT_CORS_ORIGINS
    fallback_positions_path: Path = _BACKEND_DIR / "player_positions_fallback.json"
    refresh_timezone: str = "America/Toronto"
    refresh_hour: int = 3
    refresh_minute: int = 30


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        databricks_url=os.getenv("DATABRICKS_URL"),
        databricks_http_path=os.getenv("SQL_WAREHOUSE_HTTP_PATH"),
        databricks_token=os.getenv("BACKEND_TOKEN"),
        yahoo_consumer_key=os.getenv("YAHOO_CONSUMER_KEY"),
        yahoo_consumer_secret=os.getenv("YAHOO_CONSUMER_SECRET"),
        yahoo_auth_dir=_resolve_yahoo_auth_dir(),
        cors_origins=_parse_cors_origins(),
    )
