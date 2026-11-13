from typing import Any

from pydantic import BaseModel, Field


class StreamerRequest(BaseModel):
    team1: dict[str, Any]
    team2: dict[str, Any]
    date_start: str
    roster_positions: list[Any] | None = None
    stats_source: str = "weekly_stats"
    all_rostered_names: list[str] = Field(default_factory=list)
    limit: int = Field(default=6, ge=1, le=50)
    target_drop_player: str | None = None
    pickup_mode: str = "week"
    punted_cats: list[str] = Field(default_factory=list)
