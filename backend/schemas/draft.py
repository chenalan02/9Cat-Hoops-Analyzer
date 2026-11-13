from typing import Any

from pydantic import BaseModel


class DraftPoolResponse(BaseModel):
    players: list[dict[str, Any]]
    sources_available: list[str]
    default_source: str
    total_in_db: int
