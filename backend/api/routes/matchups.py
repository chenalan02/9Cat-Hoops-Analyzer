from typing import Any

from fastapi import APIRouter, Depends, Path

from backend.api.dependencies import get_nba_schedule
from backend.controllers import matchup_controller
from backend.schemas.matchup import MatchupProjectionRequest

router = APIRouter(prefix="/leagues/{league_id}/matchups", tags=["matchups"])


@router.post("/{week_num}/projections")
def matchup_projections_endpoint(
    payload: MatchupProjectionRequest,
    league_id: str = Path(..., min_length=1),
    week_num: int = Path(..., ge=1),
    nba_schedule: Any = Depends(get_nba_schedule),
) -> dict[str, Any]:
    return matchup_controller.project_matchup(league_id, week_num, payload, nba_schedule)
