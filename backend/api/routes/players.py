from typing import Any

from fastapi import APIRouter, Depends, Path

from backend.api.dependencies import get_game_logs, get_player_stats
from backend.controllers import player_controller

router = APIRouter(prefix="/players", tags=["players"])


@router.get("/rankings")
def player_rankings_endpoint(
    player_stats: dict[str, Any] | None = Depends(get_player_stats),
    game_logs: dict[str, list[dict[str, Any]]] | None = Depends(get_game_logs),
) -> dict[str, Any]:
    return player_controller.fetch_player_rankings(player_stats, game_logs)


@router.get("/{player_name}/game-logs")
def player_game_logs_endpoint(
    player_name: str = Path(..., min_length=1),
    game_logs: dict[str, list[dict[str, Any]]] | None = Depends(get_game_logs),
) -> dict[str, Any]:
    return player_controller.fetch_player_game_logs(player_name, game_logs)
