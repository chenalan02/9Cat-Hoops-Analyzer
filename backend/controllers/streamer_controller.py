from typing import Any

from backend.core.exceptions import (
    AppError,
    BadRequestError,
    ServiceUnavailableError,
    UpstreamServiceError,
)
from backend.core.logging import logger
from backend.schemas.streamer import StreamerRequest
from backend.services.databricks_store import resolve_streamer_stats_pools
from backend.services.stats_utils import parse_iso_date
from backend.services.streamer_service import get_streamer_recommendations
from backend.services.yahoo_client import get_yahoo_query


def recommend_streamers(
    league_id: str,
    week_num: int,
    request: StreamerRequest,
    nba_schedule: Any,
    player_stats: dict[str, Any] | None,
) -> dict[str, Any]:
    if nba_schedule is None or not player_stats:
        raise ServiceUnavailableError("Projection caches are not loaded yet. Please retry shortly.")

    if not isinstance(request.team1.get("players"), list) or request.team1.get("team_id") is None:
        raise BadRequestError("team1 must include team_id and a players list.")
    if not isinstance(request.team2.get("players"), list) or request.team2.get("team_id") is None:
        raise BadRequestError("team2 must include team_id and a players list.")
    try:
        parse_iso_date(request.date_start)
    except (ValueError, TypeError) as exc:
        raise BadRequestError("date_start must be a valid ISO date string (YYYY-MM-DD).") from exc

    player_stats_pool, ros_stats_pool = resolve_streamer_stats_pools(player_stats, request.stats_source)

    try:
        yahoo_query = get_yahoo_query(league_id)
    except Exception as exc:
        logger.exception("Failed initializing Yahoo client for league_id=%s", league_id)
        raise UpstreamServiceError("Unable to authenticate with Yahoo Fantasy API.") from exc

    try:
        return get_streamer_recommendations(
            yahoo_query=yahoo_query,
            team1=request.team1,
            team2=request.team2,
            week_num=week_num,
            date_start=request.date_start,
            roster_positions=request.roster_positions,
            stats_source=request.stats_source,
            nba_schedule=nba_schedule,
            player_stats_pool=player_stats_pool,
            all_rostered_names=request.all_rostered_names or None,
            limit=request.limit,
            target_drop_player=request.target_drop_player,
            pickup_mode=request.pickup_mode,
            punted_cats=request.punted_cats,
            ros_stats_pool=ros_stats_pool,
        )
    except AppError:
        raise
    except Exception as exc:
        logger.exception("Streamer evaluation failed for league_id=%s week=%s", league_id, week_num)
        raise UpstreamServiceError("Failed to compute waiver wire recommendations.") from exc
