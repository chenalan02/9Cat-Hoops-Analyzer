from typing import Any

from pydantic import BaseModel


class MatchupProjectionRequest(BaseModel):
    team1: dict[str, Any]
    team2: dict[str, Any]
    date_start: str
    roster_positions: list[Any] | None = None
    stats_source: str = "weekly_stats"
    monte_carlo: bool = False
