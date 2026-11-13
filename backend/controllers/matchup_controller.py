from typing import Any

from backend.core.exceptions import (
    AppError,
    BadRequestError,
    ServiceUnavailableError,
    UpstreamServiceError,
)
from backend.core.logging import logger
from backend.schemas.matchup import MatchupProjectionRequest
from backend.services.matchup_service import matchup_analysis, matchup_analysis_monte_carlo
from backend.services.stats_utils import parse_iso_date
from backend.services.yahoo_client import get_yahoo_query


def _validate_matchup_inputs(request: MatchupProjectionRequest) -> None:
    if not isinstance(request.team1.get("players"), list) or request.team1.get("team_id") is None:
        raise BadRequestError("team1 must include team_id and a players list.")
    if not isinstance(request.team2.get("players"), list) or request.team2.get("team_id") is None:
        raise BadRequestError("team2 must include team_id and a players list.")
    try:
        parse_iso_date(request.date_start)
    except (ValueError, TypeError) as exc:
        raise BadRequestError("date_start must be a valid ISO date string (YYYY-MM-DD).") from exc


def project_matchup(
    league_id: str,
    week_num: int,
    request: MatchupProjectionRequest,
    nba_schedule: Any,
) -> dict[str, Any]:
    if nba_schedule is None:
        raise ServiceUnavailableError("NBA schedule cache is not loaded yet. Please retry shortly.")

    _validate_matchup_inputs(request)

    try:
        yahoo_query = get_yahoo_query(league_id)
    except Exception as exc:
        logger.exception("Failed initializing Yahoo client for league_id=%s", league_id)
        raise UpstreamServiceError("Unable to authenticate with Yahoo Fantasy API.") from exc

    runner = matchup_analysis_monte_carlo if request.monte_carlo else matchup_analysis
    try:
        return runner(
            yahoo_query=yahoo_query,
            team1=request.team1,
            team2=request.team2,
            week_num=week_num,
            date_start=request.date_start,
            roster_positions=request.roster_positions,
            stats_source=request.stats_source,
            nba_schedule=nba_schedule,
        )
    except AppError:
        raise
    except Exception as exc:
        logger.exception("Matchup projection failed for league_id=%s week=%s", league_id, week_num)
        raise UpstreamServiceError(
            "Unable to compute matchup projection from Yahoo live scoreboard data."
        ) from exc
