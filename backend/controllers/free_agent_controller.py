from typing import Any

from backend.core.exceptions import AppError, ServiceUnavailableError, UpstreamServiceError
from backend.core.logging import logger
from backend.schemas.free_agents import FreeAgentSearchRequest
from backend.services.databricks_store import resolve_table_key
from backend.services.free_agent_service import get_top_free_agents
from backend.services.yahoo_client import get_yahoo_query


def search_free_agents(
    league_id: str,
    request: FreeAgentSearchRequest,
    player_stats: dict[str, Any] | None,
) -> dict[str, Any]:
    if not player_stats:
        raise ServiceUnavailableError("Projection tables are not loaded yet. Please retry shortly.")

    try:
        yahoo_query = get_yahoo_query(league_id)
    except Exception as exc:
        logger.exception("Failed initializing Yahoo client for league_id=%s", league_id)
        raise UpstreamServiceError("Unable to authenticate with Yahoo Fantasy API.") from exc

    pool_key = resolve_table_key(request.stats_source)
    limit = max(1, min(int(request.limit or 45), 100))

    try:
        free_agents = get_top_free_agents(
            yahoo_query=yahoo_query,
            player_stats_by_source=player_stats,
            all_rostered_names=request.all_rostered_names or None,
            stats_source=pool_key,
            limit=limit,
        )
    except AppError:
        raise
    except Exception as exc:
        logger.exception("Failed fetching free agents for league_id=%s", league_id)
        raise UpstreamServiceError("Unable to load league free agents from Yahoo Fantasy API.") from exc

    return {
        "free_agents": free_agents,
        "count": len(free_agents),
    }
