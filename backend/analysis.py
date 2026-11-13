"""Compatibility exports for exploratory notebooks."""

from backend.services.draft_service import get_draft_pool
from backend.services.free_agent_service import get_top_free_agents
from backend.services.lineup_solver import (
    calculate_weekly_player_games as _calculate_weekly_player_games,
    get_league_roster_slots as _get_league_roster_slots,
    solve_optimal_lineup as _solve_optimal_lineup,
)
from backend.services.matchup_service import matchup_analysis, matchup_analysis_monte_carlo
from backend.services.stats_utils import normalize_nba_team
from backend.services.streamer_service import get_streamer_recommendations
from backend.services.yahoo_client import (
    get_yahoo_fa_info_map as _get_yahoo_fa_info_map,
    get_yahoo_fa_injury_map as _get_yahoo_fa_injury_map,
)

__all__ = [
    "matchup_analysis",
    "matchup_analysis_monte_carlo",
    "get_streamer_recommendations",
    "get_top_free_agents",
    "get_draft_pool",
    "normalize_nba_team",
    "_calculate_weekly_player_games",
    "_get_league_roster_slots",
    "_solve_optimal_lineup",
    "_get_yahoo_fa_info_map",
    "_get_yahoo_fa_injury_map",
]
