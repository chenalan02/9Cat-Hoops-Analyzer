from typing import Any

from backend.core.exceptions import (
    AppError,
    NotFoundError,
    ServiceUnavailableError,
    UpstreamServiceError,
)
from backend.core.logging import logger
from backend.models import FantasyLeague
from backend.schemas.league import LeagueSyncRequest, parse_yahoo_fantasy_link
from backend.services.yahoo_client import get_yahoo_query


def sync_league(request: LeagueSyncRequest, player_stats: dict[str, Any] | None) -> dict[str, Any]:
    if not player_stats:
        raise ServiceUnavailableError("Projection tables are not loaded yet. Please retry shortly.")

    league_id, team_id = parse_yahoo_fantasy_link(request.fantasy_link)
    try:
        yahoo_query = get_yahoo_query(league_id)
        league = FantasyLeague(yahoo_query, player_stats)
    except AppError:
        raise
    except Exception as exc:
        logger.exception("Yahoo league sync failed for league_id=%s", league_id)
        raise UpstreamServiceError(
            f"Unable to fetch league {league_id} from Yahoo Fantasy API."
        ) from exc

    if not any(str(team.team_id) == str(team_id) for team in league.teams):
        raise NotFoundError(f"Team {team_id} was not found in league {league_id}.")

    return league.to_dict()
