from fastapi import APIRouter, Request

from backend.core.exceptions import ServiceUnavailableError

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check(request: Request) -> dict:
    player_stats = getattr(request.app.state, "player_stats", None)
    nba_schedule = getattr(request.app.state, "nba_schedule", None)
    if not player_stats or nba_schedule is None:
        raise ServiceUnavailableError("Databricks caches are not initialized yet.")

    game_logs = getattr(request.app.state, "game_logs", None) or {}
    return {
        "status": "ok",
        "databricks_loaded": True,
        "nba_games_loaded": len(nba_schedule),
        "game_log_players_loaded": len(game_logs),
        "last_refreshed": getattr(request.app.state, "last_refreshed", None),
    }
