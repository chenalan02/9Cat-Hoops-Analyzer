from typing import Any

from fastapi import APIRouter, Depends, Path

from backend.api.dependencies import get_nba_schedule, get_player_stats
from backend.controllers import streamer_controller
from backend.schemas.streamer import StreamerRequest

router = APIRouter(prefix="/leagues/{league_id}/matchups", tags=["streamers"])


@router.post("/{week_num}/streamers")
def streamer_recommendations_endpoint(
    payload: StreamerRequest,
    league_id: str = Path(..., min_length=1),
    week_num: int = Path(..., ge=1),
    nba_schedule: Any = Depends(get_nba_schedule),
    player_stats: dict[str, Any] | None = Depends(get_player_stats),
) -> dict[str, Any]:
    return streamer_controller.recommend_streamers(
        league_id,
        week_num,
        payload,
        nba_schedule,
        player_stats,
    )
