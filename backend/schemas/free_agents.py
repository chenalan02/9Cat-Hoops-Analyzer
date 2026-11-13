from typing import Any

from pydantic import BaseModel, Field


class FreeAgentSearchRequest(BaseModel):
    stats_source: str = "ros_stats"
    all_rostered_names: list[str] = Field(default_factory=list)
    limit: int = Field(default=45, ge=1, le=100)


class FreeAgentSearchResponse(BaseModel):
    free_agents: list[dict[str, Any]]
    count: int
