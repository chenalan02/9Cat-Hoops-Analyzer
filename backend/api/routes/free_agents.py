from typing import Any

from fastapi import APIRouter, Depends, Path

from backend.api.dependencies import get_player_stats
from backend.controllers import free_agent_controller
from backend.schemas.free_agents import FreeAgentSearchRequest, FreeAgentSearchResponse

router = APIRouter(prefix="/leagues/{league_id}/free-agents", tags=["free-agents"])


@router.post("/search", response_model=FreeAgentSearchResponse)
def search_free_agents_endpoint(
    payload: FreeAgentSearchRequest,
    league_id: str = Path(..., min_length=1),
    player_stats: dict[str, Any] | None = Depends(get_player_stats),
) -> dict[str, Any]:
    return free_agent_controller.search_free_agents(league_id, payload, player_stats)
