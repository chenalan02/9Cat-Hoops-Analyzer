from typing import Any

from fastapi import APIRouter, Depends

from backend.api.dependencies import get_player_stats
from backend.controllers import league_controller
from backend.schemas.league import LeagueSyncRequest

router = APIRouter(prefix="/leagues", tags=["leagues"])


@router.post("/sync")
def sync_league_endpoint(
    payload: LeagueSyncRequest,
    player_stats: dict[str, Any] | None = Depends(get_player_stats),
) -> dict[str, Any]:
    return league_controller.sync_league(payload, player_stats)
