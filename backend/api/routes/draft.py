from typing import Any

from fastapi import APIRouter, Depends, Query

from backend.api.dependencies import get_player_stats
from backend.controllers import draft_controller
from backend.schemas.draft import DraftPoolResponse

router = APIRouter(prefix="/draft", tags=["draft"])


@router.get("/pool", response_model=DraftPoolResponse)
def draft_pool_endpoint(
    limit: int = Query(default=350, ge=1, le=600),
    player_stats: dict[str, Any] | None = Depends(get_player_stats),
) -> dict[str, Any]:
    return draft_controller.fetch_draft_pool(limit, player_stats)
