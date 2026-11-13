from concurrent.futures import ThreadPoolExecutor

import numpy as np

from backend.services.lineup_solver import (
    calculate_weekly_player_games,
    get_league_roster_slots,
    solve_optimal_lineup,
)
from backend.services.stats_utils import (
    build_inactive_players,
    get_safe_player_stats,
    prob_positive,
)
from backend.services.yahoo_client import get_live_team_stats, resolve_league_key

_COUNTING_STATS = ("pts", "reb", "ast", "stl", "blk", "tov", "fg3m")
_EFFICIENCY_STATS = ("fg", "ft")


def build_accumulated_stats(scoreboard1, scoreboard2, any_live_games):
    categories = [
        ("pts", True),
        ("reb", True),
        ("ast", True),
        ("stl", True),
        ("blk", True),
        ("tov", False),
        ("fg3m", True),
    ]

    t1_wins = 0
    t2_wins = 0
    ties = 0
    cat_comparison = {}

    for cat, higher_better in categories:
        v1 = scoreboard1.get(cat, 0.0)
        v2 = scoreboard2.get(cat, 0.0)
        if v1 == v2:
            ties += 1
            leader = "tie"
        elif (v1 > v2 and higher_better) or (v1 < v2 and not higher_better):
            t1_wins += 1
            leader = "team1"
        else:
            t2_wins += 1
            leader = "team2"
        cat_comparison[cat] = {"team1": v1, "team2": v2, "leader": leader}

    for eff in _EFFICIENCY_STATS:
        t1_m = scoreboard1.get(f"{eff}m", 0.0)
        t1_a = scoreboard1.get(f"{eff}a", 0.0)
        t2_m = scoreboard2.get(f"{eff}m", 0.0)
        t2_a = scoreboard2.get(f"{eff}a", 0.0)
        t1_pct = t1_m / t1_a if t1_a > 0 else 0.0
        t2_pct = t2_m / t2_a if t2_a > 0 else 0.0

        if t1_pct == t2_pct:
            ties += 1
            leader = "tie"
        elif t1_pct > t2_pct:
            t1_wins += 1
            leader = "team1"
        else:
            t2_wins += 1
            leader = "team2"

        cat_comparison[f"{eff}%"] = {
            "team1": round(t1_pct, 4),
            "team2": round(t2_pct, 4),
            "team1_split": f"{int(t1_m)}/{int(t1_a)}",
            "team2_split": f"{int(t2_m)}/{int(t2_a)}",
            "leader": leader,
        }

    has_data = any_live_games or any(v > 0 for v in scoreboard1.values()) or any(v > 0 for v in scoreboard2.values())
    return {
        "team1": scoreboard1,
        "team2": scoreboard2,
        "categories": cat_comparison,
        "has_live_stats": has_data,
        "live_score": {
            "team1_wins": t1_wins,
            "team2_wins": t2_wins,
            "ties": ties,
        },
    }


def _fetch_live_matchup_context(
    yahoo_query,
    team1,
    team2,
    week_num,
    date_start,
    roster_positions,
    stats_source,
    nba_schedule,
):
    optimal_lineups, team_schedules = solve_optimal_lineup(
        team1, team2, date_start, roster_positions, stats_source, nba_schedule
    )
    players_dict = {player["name"]: player for player in (team1["players"] + team2["players"])}
    active_slots, _ = get_league_roster_slots(roster_positions)
    active_slots_set = set(active_slots)

    league_key = resolve_league_key(yahoo_query)
    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(get_live_team_stats, yahoo_query, team1["team_id"], week_num, league_key)
        f2 = executor.submit(get_live_team_stats, yahoo_query, team2["team_id"], week_num, league_key)
        scoreboard1, live_games1 = f1.result()
        scoreboard2, live_games2 = f2.result()

    any_live_games = live_games1 or live_games2
    accumulated_stats = build_accumulated_stats(scoreboard1, scoreboard2, any_live_games)
    player_games = calculate_weekly_player_games(team1, team2, date_start, nba_schedule)
    inactive_players = build_inactive_players(team1, team2, player_games)

    return (
        optimal_lineups,
        team_schedules,
        players_dict,
        active_slots_set,
        scoreboard1,
        scoreboard2,
        accumulated_stats,
        player_games,
        inactive_players,
    )


def matchup_analysis(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule):
    (
        optimal_lineups,
        team_schedules,
        players_dict,
        active_slots_set,
        scoreboard1,
        scoreboard2,
        accumulated_stats,
        player_games,
        inactive_players,
    ) = _fetch_live_matchup_context(
        yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule
    )

    all_dist_keys = list(_COUNTING_STATS) + ["fga", "fgm", "fta", "ftm"]
    agg_dists = {
        "team1": {stat: {"mu": 0, "var": 0} for stat in all_dist_keys},
        "team2": {stat: {"mu": 0, "var": 0} for stat in all_dist_keys},
    }

    for stat, value in scoreboard1.items():
        agg_dists["team1"][stat]["mu"] = value
    for stat, value in scoreboard2.items():
        agg_dists["team2"][stat]["mu"] = value

    for team_num in ("team1", "team2"):
        team_sched = team_schedules[team_num]
        for date, lineup in optimal_lineups[team_num].items():
            players_with_game = team_sched.get(date, {})
            for slot, player_name in lineup.items():
                if slot not in active_slots_set or player_name not in players_with_game:
                    continue

                player_stats = get_safe_player_stats(players_dict[player_name], stats_source)
                for stat in _COUNTING_STATS:
                    agg_dists[team_num][stat]["mu"] += player_stats[f"mu_{stat}"]
                    agg_dists[team_num][stat]["var"] += player_stats[f"var_{stat}"]
                for stat in _EFFICIENCY_STATS:
                    agg_dists[team_num][f"{stat}a"]["mu"] += player_stats[f"mu_{stat}a"]
                    agg_dists[team_num][f"{stat}a"]["var"] += player_stats[f"var_{stat}a"]
                    agg_dists[team_num][f"{stat}m"]["mu"] += player_stats[f"mu_{stat}m"]
                    agg_dists[team_num][f"{stat}m"]["var"] += player_stats[f"var_{stat}m"]

    win_probs = {}
    for cat in _COUNTING_STATS:
        diff_mu = agg_dists["team1"][cat]["mu"] - agg_dists["team2"][cat]["mu"]
        diff_var = agg_dists["team1"][cat]["var"] + agg_dists["team2"][cat]["var"]
        win_probs[cat] = prob_positive(-diff_mu if cat == "tov" else diff_mu, diff_var)

    for cat in _EFFICIENCY_STATS:
        t1_m = agg_dists["team1"][f"{cat}m"]["mu"]
        t1_mv = agg_dists["team1"][f"{cat}m"]["var"]
        t1_a = agg_dists["team1"][f"{cat}a"]["mu"]
        t1_av = agg_dists["team1"][f"{cat}a"]["var"]

        t2_m = agg_dists["team2"][f"{cat}m"]["mu"]
        t2_mv = agg_dists["team2"][f"{cat}m"]["var"]
        t2_a = agg_dists["team2"][f"{cat}a"]["mu"]
        t2_av = agg_dists["team2"][f"{cat}a"]["var"]

        t1_eff_mu = t1_m / t1_a if t1_a > 0 else 0
        t2_eff_mu = t2_m / t2_a if t2_a > 0 else 0
        t1_eff_var = (t1_mv / (t1_a ** 2)) + (((t1_m ** 2) * t1_av) / (t1_a ** 4)) if t1_a > 0 else 0
        t2_eff_var = (t2_mv / (t2_a ** 2)) + (((t2_m ** 2) * t2_av) / (t2_a ** 4)) if t2_a > 0 else 0

        # Guard against floating-point underflow before square root in variance addition.
        diff_eff_var = max(t1_eff_var + t2_eff_var, 0)
        win_probs[f"{cat}%"] = prob_positive(t1_eff_mu - t2_eff_mu, diff_eff_var)

    return {
        "win_probs": win_probs,
        "agg_dists": agg_dists,
        "analytical_projections": agg_dists,
        "optimal_lineups": optimal_lineups,
        "team_schedules": team_schedules,
        "inactive_players": inactive_players,
        "accumulated_stats": accumulated_stats,
        "player_games": player_games,
    }


def matchup_analysis_monte_carlo(
    yahoo_query,
    team1,
    team2,
    week_num,
    date_start,
    roster_positions,
    stats_source,
    nba_schedule,
    n_sims=10000,
):
    (
        optimal_lineups,
        team_schedules,
        players_dict,
        active_slots_set,
        scoreboard1,
        scoreboard2,
        accumulated_stats,
        player_games,
        inactive_players,
    ) = _fetch_live_matchup_context(
        yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule
    )

    sim_keys = list(_COUNTING_STATS) + [f"{s}a" for s in _EFFICIENCY_STATS] + [f"{s}m" for s in _EFFICIENCY_STATS]
    base_scores = {"team1": dict(scoreboard1), "team2": dict(scoreboard2)}
    sim_agg = {
        team: {stat: np.full(n_sims, base_scores[team].get(stat, 0.0), dtype=np.float64) for stat in sim_keys}
        for team in ("team1", "team2")
    }

    for team in ("team1", "team2"):
        team_sched = team_schedules[team]
        for date, lineup in optimal_lineups[team].items():
            players_with_game = team_sched.get(date, {})
            for slot, player_name in lineup.items():
                if slot not in active_slots_set or player_name not in players_with_game:
                    continue

                player_stats = get_safe_player_stats(players_dict[player_name], stats_source)
                for stat in _COUNTING_STATS:
                    mu = player_stats[f"mu_{stat}"]
                    var = player_stats[f"var_{stat}"]
                    if var > mu and mu > 0:
                        p = mu / var
                        n = (mu ** 2) / (var - mu)
                        player_sim = np.random.negative_binomial(n, p, size=n_sims)
                    else:
                        player_sim = np.random.poisson(mu, size=n_sims)
                    sim_agg[team][stat] += player_sim

                for stat in _EFFICIENCY_STATS:
                    a_mu = player_stats[f"mu_{stat}a"]
                    a_var = player_stats[f"var_{stat}a"]
                    m_mu = player_stats[f"mu_{stat}m"]
                    m_var = player_stats[f"var_{stat}m"]

                    if a_var > a_mu and a_mu > 0:
                        p_a = a_mu / a_var
                        n_a = (a_mu ** 2) / (a_var - a_mu)
                        sim_attempts = np.random.negative_binomial(n_a, p_a, size=n_sims)
                    else:
                        sim_attempts = np.random.poisson(a_mu, size=n_sims)

                    p_mean = m_mu / a_mu if a_mu > 0 else 0
                    if a_mu > 0:
                        p_var = max((m_var / (a_mu ** 2)) - (((m_mu ** 2) * a_var) / (a_mu ** 4)), 1e-6)
                    else:
                        p_var = 0

                    max_allowed_var = p_mean * (1 - p_mean)
                    if 0 < p_var < max_allowed_var:
                        nu = (max_allowed_var / p_var) - 1
                        sim_p = np.random.beta(p_mean * nu, (1 - p_mean) * nu, size=n_sims)
                    else:
                        sim_p = np.full(n_sims, p_mean)

                    sim_makes = np.random.binomial(n=sim_attempts.astype(int), p=sim_p)
                    sim_agg[team][f"{stat}a"] += sim_attempts
                    sim_agg[team][f"{stat}m"] += sim_makes

    win_counts = {}
    win_pcts = {}

    for cat in _COUNTING_STATS:
        win_counts[cat] = (
            sim_agg["team1"][cat] < sim_agg["team2"][cat]
            if cat == "tov"
            else sim_agg["team1"][cat] > sim_agg["team2"][cat]
        )
        win_pcts[cat] = float(np.sum(win_counts[cat]) / n_sims)

    for cat in _EFFICIENCY_STATS:
        t1_eff = sim_agg["team1"][f"{cat}m"] / np.where(sim_agg["team1"][f"{cat}a"] > 0, sim_agg["team1"][f"{cat}a"], 1)
        t2_eff = sim_agg["team2"][f"{cat}m"] / np.where(sim_agg["team2"][f"{cat}a"] > 0, sim_agg["team2"][f"{cat}a"], 1)
        win_counts[f"{cat}%"] = t1_eff > t2_eff
        win_pcts[f"{cat}%"] = float(np.sum(win_counts[f"{cat}%"]) / n_sims)

    all_cat_wins = np.array([win_counts[cat] for cat in list(_COUNTING_STATS) + [f"{s}%" for s in _EFFICIENCY_STATS]])
    win_pcts["matchup"] = float(np.sum(np.sum(all_cat_wins, axis=0) > 4) / n_sims)

    sim_avg = {
        team: {cat: float(np.mean(sim_agg[team][cat])) for cat in sim_keys}
        for team in ("team1", "team2")
    }

    return {
        "win_pcts": win_pcts,
        "sim_avg": sim_avg,
        "inactive_players": inactive_players,
        "accumulated_stats": accumulated_stats,
        "player_games": player_games,
    }
