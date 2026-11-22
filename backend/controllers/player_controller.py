from typing import Any

from backend.core.exceptions import BadRequestError, ServiceUnavailableError
from backend.services.player_rankings_service import get_player_game_logs, get_player_rankings


def fetch_player_rankings(
    player_stats: dict[str, Any] | None,
    game_logs: dict[str, list[dict[str, Any]]] | None,
) -> dict[str, Any]:
    if not player_stats:
        raise ServiceUnavailableError("Projection tables are not loaded yet. Please retry shortly.")
    return get_player_rankings(player_stats, game_logs=game_logs)


def fetch_player_game_logs(
    player_name: str,
    game_logs: dict[str, list[dict[str, Any]]] | None,
) -> dict[str, Any]:
    cleaned = str(player_name or "").strip()
    if not cleaned:
        raise BadRequestError("player_name must not be empty.")
    if game_logs is None:
        raise ServiceUnavailableError("Game logs cache is not loaded yet. Please retry shortly.")
    return get_player_game_logs(game_logs, cleaned)
