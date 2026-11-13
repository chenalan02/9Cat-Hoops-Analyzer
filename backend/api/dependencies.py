from typing import Any

from fastapi import Request


def get_player_stats(request: Request) -> dict[str, Any] | None:
    return getattr(request.app.state, "player_stats", None)


def get_nba_schedule(request: Request) -> Any:
    return getattr(request.app.state, "nba_schedule", None)
