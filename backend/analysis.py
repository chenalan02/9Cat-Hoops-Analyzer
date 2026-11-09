import time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
import scipy as sp
import pulp


# Mapping between Yahoo team abbreviations and official NBA schedule abbreviations
NBA_TEAM_ALIASES = {
    "GS": "GSW", "GSW": "GSW",
    "NO": "NOP", "NOP": "NOP",
    "SA": "SAS", "SAS": "SAS",
    "PHO": "PHX", "PHX": "PHX",
    "NY": "NYK", "NYK": "NYK",
    "BRK": "BKN", "BKN": "BKN",
    "CHO": "CHA", "CHA": "CHA",
    "UTAH": "UTA", "UTA": "UTA",
    "WSH": "WAS", "WAS": "WAS",
    "OKC": "OKC", "POR": "POR", "SAC": "SAC", "TOR": "TOR", "MIA": "MIA",
    "MIL": "MIL", "MIN": "MIN", "IND": "IND", "LAC": "LAC", "LAL": "LAL",
    "MEM": "MEM", "ATL": "ATL", "BOS": "BOS", "CHI": "CHI", "CLE": "CLE",
    "DAL": "DAL", "DEN": "DEN", "DET": "DET", "HOU": "HOU", "ORL": "ORL",
    "PHI": "PHI",
}

def normalize_nba_team(abbr):
    if not abbr:
        return ""
    cleaned = str(abbr).upper().strip()
    return NBA_TEAM_ALIASES.get(cleaned, cleaned)


def _parse_yahoo_stat_value(value):
    if value is None or not str(value).strip() or str(value).strip() == "-":
        return 0.0
    return float(value)


def _calculate_weekly_player_games(team1, team2, date_start, nba_schedule):
    '''
    For each player on both teams, calculates:
    - total games scheduled in the current fantasy week (Monday to Sunday)
    - games already played (scheduled before date_start)
    - games remaining in the week (scheduled on or after date_start)
    '''
    date_start_dt = pd.to_datetime(date_start).tz_localize(None)
    # Start of fantasy week (Monday 00:00:00)
    monday = (date_start_dt - pd.Timedelta(days=date_start_dt.weekday())).floor('D')
    # End of fantasy week (next Monday 00:00:00, exclusive)
    next_monday = monday + pd.Timedelta(days=7)

    sched = nba_schedule.copy()
    if 'scheduled_date' not in sched.columns and sched.index.name == 'scheduled_date':
        sched = sched.reset_index()

    sched['scheduled_date'] = pd.to_datetime(sched['scheduled_date']).dt.tz_localize(None)
    sched['team_normalized'] = sched['team'].apply(normalize_nba_team)

    # Full week schedule: Monday through Sunday inclusive
    week_sched = sched[(sched['scheduled_date'] >= monday) & (sched['scheduled_date'] < next_monday)]

    # Total games for each NBA team in the full week
    team_total_games = week_sched.groupby('team_normalized')['scheduled_date'].count().to_dict()

    # Games played so far (scheduled before date_start day boundary)
    played_sched = week_sched[week_sched['scheduled_date'] < date_start_dt.floor('D')]
    team_played_games = played_sched.groupby('team_normalized')['scheduled_date'].count().to_dict()

    player_games = {"team1": {}, "team2": {}}
    for team_key, team in [("team1", team1), ("team2", team2)]:
        for player in team.get("players", []):
            p_name = player.get("name")
            raw_nba_team = player.get("nba_team")
            nba_team_norm = normalize_nba_team(raw_nba_team)
            total = int(team_total_games.get(nba_team_norm, 0))
            played = int(team_played_games.get(nba_team_norm, 0))
            remaining = max(0, total - played)
            player_games[team_key][p_name] = {
                "played": played,
                "total": total,
                "remaining": remaining,
                "ratio": f"{played}/{total}",
                "nba_team": raw_nba_team or nba_team_norm,
                "status": player.get("status"),
                "positions": player.get("positions"),
                "selected_position": player.get("selected_position")
            }

    return player_games


def _build_accumulated_stats(scoreboard1, scoreboard2, any_live_games):
    '''
    Formats accumulated live stats and computes category leaders & current live score.
    '''
    t1_fgm = scoreboard1.get("fgm", 0.0)
    t1_fga = scoreboard1.get("fga", 0.0)
    t1_ftm = scoreboard1.get("ftm", 0.0)
    t1_fta = scoreboard1.get("fta", 0.0)

    t2_fgm = scoreboard2.get("fgm", 0.0)
    t2_fga = scoreboard2.get("fga", 0.0)
    t2_ftm = scoreboard2.get("ftm", 0.0)
    t2_fta = scoreboard2.get("fta", 0.0)

    t1_fg_pct = t1_fgm / t1_fga if t1_fga > 0 else 0.0
    t1_ft_pct = t1_ftm / t1_fta if t1_fta > 0 else 0.0
    t2_fg_pct = t2_fgm / t2_fga if t2_fga > 0 else 0.0
    t2_ft_pct = t2_ftm / t2_fta if t2_fta > 0 else 0.0

    categories = [
        ("pts", True),
        ("reb", True),
        ("ast", True),
        ("stl", True),
        ("blk", True),
        ("tov", False),  # lower is better
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

    # FG%
    if t1_fg_pct == t2_fg_pct:
        ties += 1
        fg_leader = "tie"
    elif t1_fg_pct > t2_fg_pct:
        t1_wins += 1
        fg_leader = "team1"
    else:
        t2_wins += 1
        fg_leader = "team2"
    cat_comparison["fg%"] = {
        "team1": round(t1_fg_pct, 4),
        "team2": round(t2_fg_pct, 4),
        "team1_split": f"{int(t1_fgm)}/{int(t1_fga)}",
        "team2_split": f"{int(t2_fgm)}/{int(t2_fga)}",
        "leader": fg_leader
    }

    # FT%
    if t1_ft_pct == t2_ft_pct:
        ties += 1
        ft_leader = "tie"
    elif t1_ft_pct > t2_ft_pct:
        t1_wins += 1
        ft_leader = "team1"
    else:
        t2_wins += 1
        ft_leader = "team2"
    cat_comparison["ft%"] = {
        "team1": round(t1_ft_pct, 4),
        "team2": round(t2_ft_pct, 4),
        "team1_split": f"{int(t1_ftm)}/{int(t1_fta)}",
        "team2_split": f"{int(t2_ftm)}/{int(t2_fta)}",
        "leader": ft_leader
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
            "ties": ties
        }
    }


def _get_live_team_stats(yahoo_query, team_id, week_num, league_key=None):
    '''
    Makes a single raw API call to extract ALL 9-cat stats for a team, 
    mapping standard categories and splitting the raw FGM/FGA and FTM/FTA strings.
    '''
    if not league_key:
        league_key = getattr(yahoo_query, "_cached_league_key", None)
        if not league_key:
            league_key = yahoo_query.get_league_key()
            yahoo_query._cached_league_key = league_key

    team_key = f"{league_key}.t.{team_id}"
    url = f"https://fantasysports.yahooapis.com/fantasy/v2/team/{team_key}/stats;type=week;week={week_num}"

    # Fetch the Response object and call .json() to turn it into a dictionary
    response_obj = yahoo_query.get_response(url)
    raw_data = response_obj.json()

    stats_list = raw_data["fantasy_content"]["team"][1]["team_stats"]["stats"]

    # Map Yahoo's integer IDs to your simulator's string keys
    yahoo_stat_map = {
        "12": "pts",
        "15": "reb",
        "16": "ast",
        "17": "stl",
        "18": "blk",
        "19": "tov",
        "10": "fg3m",
    }

    live_stats = {}
    live_games = raw_data['fantasy_content']['team'][1]['team_remaining_games']['total']['live_games'] > 0

    for item in stats_list:
        if "stat" not in item:
            continue

        stat_id = str(item["stat"]["stat_id"])
        value = item["stat"]["value"]

        # 1. Handle the string splits for efficiency volume
        if stat_id == "9004003":
            ratio = str(value).strip() if value is not None else ""
            fgm, fga = ("0", "0") if ratio in {"", "-", "0"} else ratio.split("/")
            live_stats["fgm"] = _parse_yahoo_stat_value(fgm)
            live_stats["fga"] = _parse_yahoo_stat_value(fga)

        elif stat_id == "9007006":
            ratio = str(value).strip() if value is not None else ""
            ftm, fta = ("0", "0") if ratio in {"", "-", "0"} else ratio.split("/")
            live_stats["ftm"] = _parse_yahoo_stat_value(ftm)
            live_stats["fta"] = _parse_yahoo_stat_value(fta)

        # 2. Handle the standard 9 categories
        elif stat_id in yahoo_stat_map:
            cat_name = yahoo_stat_map[stat_id]

            # Yahoo uses a dash or an empty string when there are no stats yet.
            try:
                live_stats[cat_name] = _parse_yahoo_stat_value(value)
            except ValueError:
                live_stats[cat_name] = 0.0

    # Fallback to ensure volume keys exist even if a team hasn't taken a shot yet
    for key in ["fgm", "fga", "ftm", "fta"]:
        if key not in live_stats:
            live_stats[key] = 0.0
            
    return live_stats, live_games


def _get_league_roster_slots(roster_positions):
    '''
    Get the roster slots of the league in list format
    '''
    active_slots = []
    inactive_slots = []
    for position in roster_positions:
        # Handle both dict (from API payload) and custom yfpy RosterPosition object
        if isinstance(position, dict):
            is_starting = position.get("is_starting_position", False)
            count = position.get("count", 0)
            pos_name = position.get("position", "")
        else:
            is_starting = getattr(position, "is_starting_position", False)
            count = getattr(position, "count", 0)
            pos_name = getattr(position, "position", "")

        if is_starting:
            for i in range(count):
                active_slots.append(pos_name + "_" + str(i+1))
        else:
            for i in range(count):
                inactive_slots.append(pos_name + "_" + str(i+1))

    return active_slots, inactive_slots


def _get_safe_player_stats(player_info, stats_source):
    stats = player_info.get(stats_source, {}) or {}
    defaults = {
        "rank": 999,
        "proj_games_played": None,
    }
    for stat in ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]:
        defaults[f"mu_{stat}"] = 0.0
        defaults[f"var_{stat}"] = 0.0
    for stat in ["fg", "ft"]:
        defaults[f"mu_{stat}a"] = 0.0
        defaults[f"var_{stat}a"] = 0.0
        defaults[f"mu_{stat}m"] = 0.0
        defaults[f"var_{stat}m"] = 0.0
    
    return {**defaults, **{k: v for k, v in stats.items() if v is not None}}


def _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule):
    '''
    Get game schedule for the week for both teams, then solve for the optimal lineup based on player stats and roster positions.
    '''
    # get game schedule for each player on both teams for the week
    team1_schedule = {}
    team2_schedule = {}

    date_start_dt = pd.to_datetime(date_start).tz_localize(None)
    next_sunday = (date_start_dt + pd.Timedelta(days=(6 - date_start_dt.weekday()))).floor('D')

    sched = nba_schedule.copy()
    if 'scheduled_date' not in sched.columns and sched.index.name == 'scheduled_date':
        sched = sched.reset_index()

    sched['scheduled_date'] = pd.to_datetime(sched['scheduled_date']).dt.tz_localize(None).dt.floor('D')
    sched['team_normalized'] = sched['team'].apply(normalize_nba_team)
    sched = sched.set_index('scheduled_date').sort_index()
    sched = sched.loc[date_start_dt.floor('D'):next_sunday]

    for date in pd.date_range(start=date_start_dt.floor('D'), end=next_sunday, freq='D'):
        team1_schedule[date.strftime('%Y-%m-%d')] = {}
        team2_schedule[date.strftime('%Y-%m-%d')] = {}
        if date in sched.index:
            daily_schedule = sched.loc[[date]]
            games_info = daily_schedule.set_index('team_normalized').to_dict(orient='index')
        else:
            games_info = {}
        teams_set = set(games_info.keys())

        for player in team1["players"]:
            p_nba = normalize_nba_team(player.get('nba_team'))
            if p_nba in teams_set:
                team1_schedule[date.strftime('%Y-%m-%d')][player['name']] = games_info[p_nba]
        for player in team2["players"]:
            p_nba = normalize_nba_team(player.get('nba_team'))
            if p_nba in teams_set:
                team2_schedule[date.strftime('%Y-%m-%d')][player['name']] = games_info[p_nba]

    # solve for optimal lineup each day based on the schedule and player rankings
    team_lineups = {"team1": {}, "team2": {}}

    for team_num, team in [("team1", team1), ("team2", team2)]:
        for date in pd.date_range(start=date_start, end=next_sunday, freq='D'):

            team_lineups[team_num][date.strftime('%Y-%m-%d')] = {}

            prob = pulp.LpProblem("Optimal_Lineup", pulp.LpMaximize)
            active_slots, inactive_slots = _get_league_roster_slots(roster_positions)
            roster_slots = active_slots + inactive_slots

            # decision variables
            choices = pulp.LpVariable.dicts(
                "assign",
                ((player['name'], slot) for player in team["players"] for slot in roster_slots),
                cat='Binary'
            )

            # constraint 1: each player can only be assigned to 1 slot
            for player in team["players"]:
                p_name = player['name']
                clean_p_name = "".join(c if c.isalnum() or c == '_' else '_' for c in p_name.replace(' ', '_'))
                prob += (
                    pulp.lpSum(choices[(p_name, slot)] for slot in roster_slots) == 1,
                    f"Slot_{clean_p_name}_one_slot"
                )

            # constraint 2: each slot can only be assigned to at most 1 player
            for slot in roster_slots:
                prob += (
                    pulp.lpSum(choices[(player['name'], slot)] for player in team["players"]) <= 1,
                    f"Slot_{slot}_one_player"
                )

            # constraint 3: Position eligibility and objective function based on ranking
            objective_terms = []

            def can_play(player_positions, player_status, slot_name):
                '''
                Check if a player can be assigned to a slot based on their position and injury status
                '''
                slot_type = slot_name.split("_")[0]  # remove _1, _2, etc.
                # dont allow injured players to be in active slot
                if player_status in ["O", "INJ"]:
                    return slot_type in ["BN", "IL+", "IL"]
                elif slot_type in ["BN", "Util"]:
                    return True
                elif slot_type == "IL" and player_status == "INJ":
                    return True
                elif slot_type == "IL+" and player_status in ["INJ", "O"]:
                    return True
                elif slot_type == "G" and any(pos in ["PG", "SG"] for pos in player_positions):
                    return True
                elif slot_type == "F" and any(pos in ["SF", "PF"] for pos in player_positions):
                    return True
                else:
                    return slot_type in player_positions
                
            players_with_game = team1_schedule[date.strftime('%Y-%m-%d')].keys() if team == team1 else team2_schedule[date.strftime('%Y-%m-%d')].keys()

            for player_info in team["players"]:
                player_name = player_info['name']
                player_positions = player_info['positions']
                player_status = player_info['status']
                player_stats = _get_safe_player_stats(player_info, stats_source)
                game_scheduled = player_name in players_with_game

                player_rank_score = 1000 - player_stats['rank']

                for slot in roster_slots:
                    if can_play(player_positions, player_status, slot):
                        if slot in active_slots and game_scheduled:
                            slot_bonus = 100000
                        else:
                            slot_bonus = 0
                        weight = slot_bonus + player_rank_score
                        objective_terms.append(choices[(player_name, slot)] * weight)

                    else:
                        clean_player_name = "".join(c if c.isalnum() or c == '_' else '_' for c in player_name.replace(' ', '_'))
                        prob += (
                            choices[(player_name, slot)] == 0,
                            f"Eligibility_{clean_player_name}_{slot}"
                        )
            
            prob += pulp.lpSum(objective_terms), "Total_Ranking_Score"

            # solve optimization problem and save results
            prob.solve(pulp.PULP_CBC_CMD(msg=False))
            
            for player_info in team["players"]:
                p_name = player_info['name']
                for slot in roster_slots:
                    if pulp.value(choices[(p_name, slot)]) == 1.0:
                        team_lineups[team_num][date.strftime('%Y-%m-%d')][slot] = p_name

    return team_lineups, {"team1": team1_schedule, "team2": team2_schedule}


def matchup_analysis(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule):
    '''
    Analyze the matchup between two teams for the week, considering their schedules and player stats.
    '''

    optimal_lineups, team_schedules = _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule)
    players_list = team1["players"] + team2["players"]
    players_dict = {player['name']: player for player in players_list}

    active_slots, _ = _get_league_roster_slots(roster_positions)
    active_slots_set = set(active_slots)

    counting_stats = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
    efficiency_stats = ["fg", "ft"]

    def get_base_dist():
        return {stat: {"mu": 0, "var": 0} for stat in 
            ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fga", "fgm", "fta", "ftm"]}

    agg_dists = {
        "team1": get_base_dist(),
        "team2": get_base_dist()
    }

    # fill aggregate stats from previous games concurrently
    league_key = getattr(yahoo_query, "_cached_league_key", None)
    if not league_key:
        league_key = yahoo_query.get_league_key()
        yahoo_query._cached_league_key = league_key

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(_get_live_team_stats, yahoo_query, team1["team_id"], week_num, league_key)
        f2 = executor.submit(_get_live_team_stats, yahoo_query, team2["team_id"], week_num, league_key)
        scoreboard1, live_games1 = f1.result()
        scoreboard2, live_games2 = f2.result()

    any_live_games = live_games1 or live_games2
    for stat, value in scoreboard1.items():
        agg_dists["team1"][stat]["mu"] = value
    for stat, value in scoreboard2.items():
        agg_dists["team2"][stat]["mu"] = value

    # fill aggregate stats dists with probability dists
    for team_num, team in [("team1", team1), ("team2", team2)]:
        team_sched = team_schedules[team_num]
        for date, lineup in optimal_lineups[team_num].items():
            players_with_game = team_sched.get(date, {})
            for slot, player_name in lineup.items():
                # A player only contributes stats if placed in an active starting slot AND actually playing in a game on that date
                if slot not in active_slots_set or player_name not in players_with_game:
                    continue

                player_info = players_dict[player_name]
                player_stats = _get_safe_player_stats(player_info, stats_source)

                if player_stats["proj_games_played"] is not None:
                    for stat in counting_stats:
                        agg_dists[team_num][stat]["mu"] += player_stats["mu_" + stat]
                        agg_dists[team_num][stat]["var"] += player_stats["var_" + stat]

                    for stat in efficiency_stats:
                        agg_dists[team_num][f"{stat}a"]["mu"] += player_stats[f"mu_{stat}a"]
                        agg_dists[team_num][f"{stat}a"]["var"] += player_stats[f"var_{stat}a"]
                        agg_dists[team_num][f"{stat}m"]["mu"] += player_stats[f"mu_{stat}m"]
                        agg_dists[team_num][f"{stat}m"]["var"] += player_stats[f"var_{stat}m"]

    win_probs = {}

    for cat in counting_stats:
        team1_mu = agg_dists["team1"][cat]["mu"]
        team1_var = agg_dists["team1"][cat]["var"]
        team2_mu = agg_dists["team2"][cat]["mu"]
        team2_var = agg_dists["team2"][cat]["var"]

        # Using normal approximation for difference of two independent random variables
        diff_mu = team1_mu - team2_mu
        diff_var = team1_var + team2_var  # variances add for independent variables

        # Calculate probability that team1 outperforms team2 in this category (lower is better for tov)
        if cat == "tov":
            prob_team1_wins = sp.stats.norm.cdf(0, loc=diff_mu, scale=np.sqrt(diff_var))
        else:
            prob_team1_wins = 1 - sp.stats.norm.cdf(0, loc=diff_mu, scale=np.sqrt(diff_var))
        win_probs[cat] = prob_team1_wins

    for cat in efficiency_stats:
        team1_m_mu = agg_dists["team1"][f"{cat}m"]["mu"]
        team1_m_var = agg_dists["team1"][f"{cat}m"]["var"]
        team1_a_mu = agg_dists["team1"][f"{cat}a"]["mu"]
        team1_a_var = agg_dists["team1"][f"{cat}a"]["var"]

        team2_m_mu = agg_dists["team2"][f"{cat}m"]["mu"]
        team2_m_var = agg_dists["team2"][f"{cat}m"]["var"]
        team2_a_mu = agg_dists["team2"][f"{cat}a"]["mu"]
        team2_a_var = agg_dists["team2"][f"{cat}a"]["var"]

        team1_eff_mu = team1_m_mu / team1_a_mu if team1_a_mu > 0 else 0
        team2_eff_mu = team2_m_mu / team2_a_mu if team2_a_mu > 0 else 0

        # Delta Method variance formula
        if team1_a_mu > 0:
            team1_eff_var = (team1_m_var / (team1_a_mu ** 2)) + (((team1_m_mu ** 2) * team1_a_var) / (team1_a_mu ** 4))
        else:
            team1_eff_var = 0
            
        if team2_a_mu > 0:
            team2_eff_var = (team2_m_var / (team2_a_mu ** 2)) + (((team2_m_mu ** 2) * team2_a_var) / (team2_a_mu ** 4))
        else:
            team2_eff_var = 0

        diff_eff_mu = team1_eff_mu - team2_eff_mu
        
        # Max(..., 0) prevents highly unlikely floating point calculation errors from breaking the square root
        diff_eff_var = max(team1_eff_var + team2_eff_var, 0)

        win_probs[f"{cat}%"] = sp.stats.norm.sf(0, loc=diff_eff_mu, scale=np.sqrt(diff_eff_var)) if diff_eff_var > 0 else 0.5

    # Collect players who are injured or projected to play 0 games
    inactive_players = {"team1": [], "team2": []}
    for team_key, team in [("team1", team1), ("team2", team2)]:
        for player in team["players"]:
            player_stats = player.get(stats_source, {}) or {}
            is_injured = player.get("status") is not None and player.get("status") != ""
            is_zero_games = player_stats.get("proj_games_played") is None
            if is_injured or is_zero_games:
                inactive_players[team_key].append({
                    "name": player.get("name"),
                    "status": player.get("status"),
                    "proj_games_played": player_stats.get("proj_games_played")
                })

    accumulated_stats = _build_accumulated_stats(scoreboard1, scoreboard2, any_live_games)
    player_games = _calculate_weekly_player_games(team1, team2, date_start, nba_schedule)

    return {
        "win_probs": win_probs,
        "agg_dists": agg_dists,
        "inactive_players": inactive_players,
        "accumulated_stats": accumulated_stats,
        "player_games": player_games
    }


def matchup_analysis_monte_carlo(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule, n_sims=10000):
    '''
    Analyze the matchup between two teams for the week, considering their schedules and player stats.
    '''
    optimal_lineups, team_schedules = _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule)
    players_list = team1["players"] + team2["players"]
    players_dict = {player['name']: player for player in players_list}

    active_slots, _ = _get_league_roster_slots(roster_positions)
    active_slots_set = set(active_slots)

    counting_stats = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
    efficiency_stats = ["fg", "ft"]

    # fill aggregate stats from previous games concurrently
    agg_dists = {"team1": {}, "team2": {}}
    league_key = getattr(yahoo_query, "_cached_league_key", None)
    if not league_key:
        league_key = yahoo_query.get_league_key()
        yahoo_query._cached_league_key = league_key

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(_get_live_team_stats, yahoo_query, team1["team_id"], week_num, league_key)
        f2 = executor.submit(_get_live_team_stats, yahoo_query, team2["team_id"], week_num, league_key)
        scoreboard1, live_games1 = f1.result()
        scoreboard2, live_games2 = f2.result()

    any_live_games = live_games1 or live_games2
    for stat, value in scoreboard1.items():
        agg_dists["team1"][stat] = value
    for stat, value in scoreboard2.items():
        agg_dists["team2"][stat] = value
    
    def get_base_dict(team):
        return {stat: np.full(n_sims, agg_dists[team][stat]) for stat in counting_stats + [f"{stat}a" for stat in efficiency_stats] + [f"{stat}m" for stat in efficiency_stats]}
    # aggrgegate counts for each category for each sim
    sim_agg = {"team1": get_base_dict("team1"),
               "team2": get_base_dict("team2")}

    win_counts = {}
    win_pcts = {}
    
    for team in ["team1", "team2"]:
        team_sched = team_schedules[team]
        for date, lineup in optimal_lineups[team].items():
            players_with_game = team_sched.get(date, {})
            sim_agg[team][date] = {}
            for slot, player_name in lineup.items():
                if slot not in active_slots_set or player_name not in players_with_game:
                    continue

                player_info = players_dict[player_name]
                player_stats = _get_safe_player_stats(player_info, stats_source)

                if player_stats["proj_games_played"] is not None:
                    # negative binomial sim for counting stats, poisson if not overdispersed
                    for stat in counting_stats:
                        mu = player_stats["mu_" + stat]
                        var = player_stats["var_" + stat]

                        if var > mu and mu > 0:
                            p = mu / var
                            n = (mu ** 2) / (var - mu)
                            player_sim = np.random.negative_binomial(n, p, size=n_sims)
                        else:
                            player_sim = np.random.poisson(mu, size=n_sims)

                        sim_agg[team][stat] += player_sim

                    # simulate attempts and makes for efficiency stats
                    for stat in efficiency_stats:
                        a_mu = player_stats[f"mu_{stat}a"]
                        a_var = player_stats[f"var_{stat}a"]
                        m_mu = player_stats[f"mu_{stat}m"]
                        m_var = player_stats[f"var_{stat}m"]

                        # simulate attempts with negative binomial if overdispersed, otherwise poisson
                        if a_var > a_mu and a_mu > 0:
                            p_a = a_mu / a_var
                            n_a = (a_mu ** 2) / (a_var - a_mu)
                            sim_A = np.random.negative_binomial(n_a, p_a, size=n_sims)
                        else:
                            sim_A = np.random.poisson(a_mu, size=n_sims)

                        # simulate true percentage as beta distribution
                        p_mean = m_mu / a_mu if a_mu > 0 else 0

                        if a_mu > 0:
                            p_var = (m_var / (a_mu ** 2)) - (((m_mu ** 2) * a_var) / (a_mu ** 4))
                            p_var = max(p_var, 1e-6)
                        else:
                            p_var = 0

                        max_allowed_var = p_mean * (1 - p_mean)
                        if 0 < p_var < max_allowed_var:
                            nu = (max_allowed_var / p_var) - 1
                            alpha = p_mean * nu
                            beta = (1 - p_mean) * nu
                            sim_p = np.random.beta(alpha, beta, size=n_sims)
                        else:
                            sim_p = np.full(n_sims, p_mean)

                        # simulate makes from binomial distribution
                        sim_M = np.random.binomial(n=sim_A.astype(int), p=sim_p)

                        sim_agg[team][f"{stat}a"] += sim_A
                        sim_agg[team][f"{stat}m"] += sim_M

    # calculate win probabilities based on sims (lower is better for tov)
    for cat in counting_stats:
        if cat == "tov":
            win_counts[cat] = sim_agg["team1"][cat] < sim_agg["team2"][cat]
        else:
            win_counts[cat] = sim_agg["team1"][cat] > sim_agg["team2"][cat]
        win_pcts[cat] = np.sum(win_counts[cat]) / n_sims
    
    for cat in efficiency_stats:
        team1_eff = sim_agg["team1"][f"{cat}m"] / np.where(sim_agg["team1"][f"{cat}a"] > 0, sim_agg["team1"][f"{cat}a"], 1)
        team2_eff = sim_agg["team2"][f"{cat}m"] / np.where(sim_agg["team2"][f"{cat}a"] > 0, sim_agg["team2"][f"{cat}a"], 1)
        win_counts[f"{cat}%"] = team1_eff > team2_eff
        win_pcts[f"{cat}%"] = np.sum(win_counts[f"{cat}%"]) / n_sims

    all_cat_wins = np.array([win_counts[cat] for cat in counting_stats + [f"{stat}%" for stat in efficiency_stats]])
    matchup_wins = np.sum(all_cat_wins, axis=0) > 4
    win_pcts["matchup"] = np.sum(matchup_wins) / n_sims

    # get average results for each category for each team across all simulations
    sim_avg = {
        team: {
            cat: np.mean(sim_agg[team][cat]) 
            for cat in counting_stats + [f"{stat}a" for stat in efficiency_stats] + [f"{stat}m" for stat in efficiency_stats]
        } 
        for team in ["team1", "team2"]
    }   

    # Collect players who are injured or projected to play 0 games
    inactive_players = {"team1": [], "team2": []}
    for team_key, team in [("team1", team1), ("team2", team2)]:
        for player in team["players"]:
            player_stats = player.get(stats_source, {}) or {}
            is_injured = player.get("status") is not None and player.get("status") != ""
            is_zero_games = player_stats.get("proj_games_played") is None
            if is_injured or is_zero_games:
                inactive_players[team_key].append({
                    "name": player.get("name"),
                    "status": player.get("status"),
                    "proj_games_played": player_stats.get("proj_games_played")
                })

    accumulated_stats = _build_accumulated_stats(scoreboard1, scoreboard2, any_live_games)
    player_games = _calculate_weekly_player_games(team1, team2, date_start, nba_schedule)

    return {
        "win_pcts": win_pcts,
        "sim_avg": sim_avg,
        "inactive_players": inactive_players,
        "accumulated_stats": accumulated_stats,
        "player_games": player_games
    }


def get_streamer_recommendations(
    yahoo_query,
    team1,
    team2,
    week_num,
    date_start,
    roster_positions,
    stats_source,
    nba_schedule,
    player_stats_pool,
    all_rostered_names=None,
    limit=6
):
    '''
    Evaluates free agent streamers to maximize expected matchup wins for team1.
    Considers category leverage (safe vs swing vs doomed), roster actions (IR stash vs drop),
    and daily startable lineup compatibility from date_start through Sunday.
    '''
    date_start_dt = pd.to_datetime(date_start).tz_localize(None)
    next_sunday = (date_start_dt + pd.Timedelta(days=(6 - date_start_dt.weekday()))).floor('D')

    # 1. Run baseline matchup analysis
    baseline = matchup_analysis(
        yahoo_query=yahoo_query,
        team1=team1,
        team2=team2,
        week_num=week_num,
        date_start=date_start,
        roster_positions=roster_positions,
        stats_source=stats_source,
        nba_schedule=nba_schedule
    )

    baseline_win_probs = baseline.get("win_probs", {})
    baseline_proj = baseline.get("analytical_projections", {})
    optimal_lineups = baseline.get("optimal_lineups", {})
    team_schedules = baseline.get("team_schedules", {})

    counting_stats = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
    cat_keys = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fg%", "ft%"]

    # 2. Category Diagnostics & Triage
    category_diagnostics = {}
    for cat in cat_keys:
        p0 = baseline_win_probs.get(cat, 0.5)
        if cat in ["fg%", "ft%"]:
            prefix = "fg" if cat == "fg%" else "ft"
            t1_m = baseline_proj.get("team1", {}).get(f"{prefix}m", {}).get("mu", 0)
            t1_a = baseline_proj.get("team1", {}).get(f"{prefix}a", {}).get("mu", 0)
            t2_m = baseline_proj.get("team2", {}).get(f"{prefix}m", {}).get("mu", 0)
            t2_a = baseline_proj.get("team2", {}).get(f"{prefix}a", {}).get("mu", 0)
            t1_rate = t1_m / t1_a if t1_a > 0 else 0
            t2_rate = t2_m / t2_a if t2_a > 0 else 0
            margin = (t1_rate - t2_rate) * 100
        else:
            t1_mu = baseline_proj.get("team1", {}).get(cat, {}).get("mu", 0)
            t2_mu = baseline_proj.get("team2", {}).get(cat, {}).get("mu", 0)
            margin = t1_mu - t2_mu

        if p0 >= 0.85:
            status = "SAFE"
            target = False
        elif p0 <= 0.15:
            status = "DOOMED"
            target = False
        else:
            status = "SWING"
            target = True

        category_diagnostics[cat] = {
            "status": status,
            "p_win": round(float(p0), 4),
            "margin": round(float(margin), 2),
            "target": target
        }

    # 3. Determine Roster Action (IR Stash vs Drop)
    active_slots, _ = _get_league_roster_slots(roster_positions)
    active_slots_set = set(active_slots)

    active_or_bench_injured = [
        p for p in team1.get("players", [])
        if p.get("status") in ["INJ", "O", "IL", "OUT", "INJURED"]
        and p.get("selected_position") not in ["IL", "IL+"]
    ]

    total_il_slots = sum(1 for slot in roster_positions if slot in ["IL", "IL+"])
    occupied_il_slots = sum(1 for p in team1.get("players", []) if p.get("selected_position") in ["IL", "IL+"])
    open_il_slots = max(0, total_il_slots - occupied_il_slots)

    def get_player_starts(player_name):
        starts = 0
        t1_lineups = optimal_lineups.get("team1", {})
        t1_sched = team_schedules.get("team1", {})
        for d, lineup in t1_lineups.items():
            players_with_game = t1_sched.get(d, {})
            if player_name in players_with_game:
                for slot, p_in_slot in lineup.items():
                    if slot in active_slots_set and p_in_slot == player_name:
                        starts += 1
        return starts

    # 3. Filter Candidate Free Agents first to establish the Free Agent Z-score baseline
    if all_rostered_names is None:
        all_rostered_names = set(p["name"] for p in team1.get("players", []) + team2.get("players", []))
    else:
        all_rostered_names = set(all_rostered_names)

    fa_candidates = []
    for p_name, p_stats in (player_stats_pool or {}).items():
        if p_name in all_rostered_names:
            continue
        if (p_stats.get("games_played") or 0) < 3:
            continue
        if (p_stats.get("mu_min") or 0) < 13.0:
            continue
        raw_team = p_stats.get("team")
        if not raw_team:
            continue
        norm_team = normalize_nba_team(raw_team)
        fa_candidates.append((p_name, norm_team, p_stats))

    fa_candidates.sort(
        key=lambda x: (x[2].get("z_total") if x[2].get("z_total") is not None else -99),
        reverse=True
    )
    top_fa_pool = fa_candidates[:60]

    top_fa_zs = [
        float(x[2].get("z_total"))
        for x in top_fa_pool[:5]
        if x[2].get("z_total") is not None
    ]
    fa_benchmark_z = float(np.mean(top_fa_zs)) if top_fa_zs else -3.5

    def get_player_z(p):
        val = (
            p.get("z_total")
            if p.get("z_total") is not None
            else p.get(stats_source, {}).get("z_total")
            if p.get(stats_source, {}).get("z_total") is not None
            else p.get("ema_stats", {}).get("z_total")
        )
        return float(val) if val is not None else 0.0

    # 4. Identify Roster Action (IR Stash vs Free-Agent-Compared Drop)
    if active_or_bench_injured and open_il_slots > 0:
        stashed_player = active_or_bench_injured[0]
        roster_action = {
            "type": "MOVE_TO_IR",
            "target_player": stashed_player.get("name"),
            "reason": f"Move {stashed_player.get('name')} ({stashed_player.get('status')}) to open IL slot (0 drops required)."
        }
        drop_player = None
        drop_starts = 0
    else:
        t1_players = [
            p for p in team1.get("players", [])
            if p.get("selected_position") not in ("IL", "IL+", "NA")
        ] or team1.get("players", [])

        sorted_bench = sorted(t1_players, key=get_player_z)
        fa_comparable_drops = [
            p for p in sorted_bench
            if get_player_z(p) <= fa_benchmark_z + 1.25
        ]

        if fa_comparable_drops:
            drop_player = min(
                fa_comparable_drops,
                key=lambda p: (get_player_starts(p.get("name")), get_player_z(p))
            )
            drop_starts = get_player_starts(drop_player.get("name"))
            drop_z = get_player_z(drop_player)
            roster_action = {
                "type": "DROP",
                "target_player": drop_player.get("name"),
                "drop_z": round(drop_z, 2),
                "fa_benchmark_z": round(fa_benchmark_z, 2),
                "reason": (
                    f"Drop {drop_player.get('name')} (Z: {drop_z:+.2f}, {drop_starts} start{'s' if drop_starts != 1 else ''} left) "
                    f"— comparable to top Free Agents (Z: {fa_benchmark_z:+.2f})."
                )
            }
        else:
            pool_size = max(1, len(sorted_bench) // 3)
            candidates = sorted_bench[:pool_size]
            drop_player = min(
                candidates,
                key=lambda p: (get_player_starts(p.get("name")), get_player_z(p))
            )
            drop_starts = get_player_starts(drop_player.get("name"))
            drop_z = get_player_z(drop_player)
            roster_action = {
                "type": "HOLD_WARNING",
                "target_player": drop_player.get("name"),
                "drop_z": round(drop_z, 2),
                "fa_benchmark_z": round(fa_benchmark_z, 2),
                "reason": (
                    f"No clear drop: lowest bench player {drop_player.get('name')} (Z: {drop_z:+.2f}, {drop_starts} start{'s' if drop_starts != 1 else ''} left) "
                    f"ranks above top Free Agents (Z: {fa_benchmark_z:+.2f}). Only stream if crucial for this week."
                )
            }

    # 5. NBA Schedule & Lineup Slot Availability
    sched = nba_schedule.copy()
    if 'scheduled_date' not in sched.columns and sched.index.name == 'scheduled_date':
        sched = sched.reset_index()
    sched['scheduled_date'] = pd.to_datetime(sched['scheduled_date']).dt.tz_localize(None).dt.floor('D')
    sched['team_normalized'] = sched['team'].apply(normalize_nba_team)

    window_sched = sched[(sched['scheduled_date'] >= date_start_dt.floor('D')) & (sched['scheduled_date'] <= next_sunday)]

    team_game_dates = {}
    for team_abbr, group in window_sched.groupby('team_normalized'):
        team_game_dates[team_abbr] = set(group['scheduled_date'].dt.strftime('%Y-%m-%d'))

    date_strings = [d.strftime('%Y-%m-%d') for d in pd.date_range(start=date_start_dt.floor('D'), end=next_sunday, freq='D')]
    t1_lineups = optimal_lineups.get("team1", {})
    t1_sched = team_schedules.get("team1", {})

    open_slots_by_date = {}
    for d_str in date_strings:
        lineup = t1_lineups.get(d_str, {})
        players_with_game = t1_sched.get(d_str, {})
        open_count = 0
        for slot in active_slots:
            assigned_p = lineup.get(slot)
            if not assigned_p:
                open_count += 1
            elif assigned_p not in players_with_game:
                open_count += 1
            elif drop_player and assigned_p == drop_player.get("name"):
                open_count += 1
        open_slots_by_date[d_str] = open_count

    drop_stats = _get_safe_player_stats(drop_player, stats_source) if drop_player else None

    # 6. Evaluate Each Free Agent
    recommendations = []

    for p_name, norm_team, p_stats in top_fa_pool:
        s_dates = team_game_dates.get(norm_team, set())
        startable_dates = [d_str for d_str in date_strings if d_str in s_dates and open_slots_by_date.get(d_str, 0) > 0]
        startable_games = len(startable_dates)

        if startable_games == 0:
            continue

        total_games_in_window = len([d_str for d_str in date_strings if d_str in s_dates])
        clashes = total_games_in_window - startable_games

        new_win_probs = {}
        boosted_cats = []
        risk_flags = []
        delta_e = 0.0

        # Counting stats evaluation
        for cat in counting_stats:
            base_t1_mu = baseline_proj.get("team1", {}).get(cat, {}).get("mu", 0.0)
            base_t1_var = baseline_proj.get("team1", {}).get(cat, {}).get("var", 0.0)
            base_t2_mu = baseline_proj.get("team2", {}).get(cat, {}).get("mu", 0.0)
            base_t2_var = baseline_proj.get("team2", {}).get(cat, {}).get("var", 0.0)

            delta_mu = startable_games * (p_stats.get(f"mu_{cat}") or 0.0)
            delta_var = startable_games * (p_stats.get(f"var_{cat}") or 0.0)

            if drop_stats and drop_starts > 0:
                delta_mu -= drop_starts * (drop_stats.get(f"mu_{cat}") or 0.0)
                delta_var -= drop_starts * (drop_stats.get(f"var_{cat}") or 0.0)

            new_t1_mu = base_t1_mu + delta_mu
            new_t1_var = max(0.01, base_t1_var + delta_var)

            diff_mu = new_t1_mu - base_t2_mu
            diff_var = max(0.01, new_t1_var + base_t2_var)

            if cat == "tov":
                p_win = sp.stats.norm.cdf(0, loc=diff_mu, scale=np.sqrt(diff_var))
            else:
                p_win = 1 - sp.stats.norm.cdf(0, loc=diff_mu, scale=np.sqrt(diff_var))

            new_win_probs[cat] = p_win
            p_base = baseline_win_probs.get(cat, 0.5)
            cat_delta_p = p_win - p_base
            delta_e += cat_delta_p

            if category_diagnostics[cat]["target"] and cat_delta_p >= 0.03:
                boosted_cats.append({
                    "cat": cat.upper(),
                    "before_p": round(float(p_base), 3),
                    "after_p": round(float(p_win), 3),
                    "delta_p": round(float(cat_delta_p), 3),
                    "gain": f"{'+' if delta_mu >= 0 else ''}{delta_mu:.1f} {cat.upper()}"
                })

            if cat == "tov" and cat_delta_p <= -0.05:
                risk_flags.append(f"Turnover Risk ({delta_mu:+.1f} TO)")

        # Efficiency stats evaluation (FG% and FT%)
        for cat in ["fg", "ft"]:
            base_t1_m_mu = baseline_proj.get("team1", {}).get(f"{cat}m", {}).get("mu", 0.0)
            base_t1_m_var = baseline_proj.get("team1", {}).get(f"{cat}m", {}).get("var", 0.0)
            base_t1_a_mu = baseline_proj.get("team1", {}).get(f"{cat}a", {}).get("mu", 0.0)
            base_t1_a_var = baseline_proj.get("team1", {}).get(f"{cat}a", {}).get("var", 0.0)

            base_t2_m_mu = baseline_proj.get("team2", {}).get(f"{cat}m", {}).get("mu", 0.0)
            base_t2_m_var = baseline_proj.get("team2", {}).get(f"{cat}m", {}).get("var", 0.0)
            base_t2_a_mu = baseline_proj.get("team2", {}).get(f"{cat}a", {}).get("mu", 0.0)
            base_t2_a_var = baseline_proj.get("team2", {}).get(f"{cat}a", {}).get("var", 0.0)

            delta_m = startable_games * (p_stats.get(f"mu_{cat}m") or 0.0)
            delta_m_var = startable_games * (p_stats.get(f"var_{cat}m") or 0.0)
            delta_a = startable_games * (p_stats.get(f"mu_{cat}a") or 0.0)
            delta_a_var = startable_games * (p_stats.get(f"var_{cat}a") or 0.0)

            if drop_stats and drop_starts > 0:
                delta_m -= drop_starts * (drop_stats.get(f"mu_{cat}m") or 0.0)
                delta_m_var -= drop_starts * (drop_stats.get(f"var_{cat}m") or 0.0)
                delta_a -= drop_starts * (drop_stats.get(f"mu_{cat}a") or 0.0)
                delta_a_var -= drop_starts * (drop_stats.get(f"var_{cat}a") or 0.0)

            new_t1_m = max(0.0, base_t1_m_mu + delta_m)
            new_t1_m_var = max(0.01, base_t1_m_var + delta_m_var)
            new_t1_a = max(0.01, base_t1_a_mu + delta_a)
            new_t1_a_var = max(0.01, base_t1_a_var + delta_a_var)

            new_t1_eff_mu = new_t1_m / new_t1_a
            new_t1_eff_var = (new_t1_m_var / (new_t1_a ** 2)) + (((new_t1_m ** 2) * new_t1_a_var) / (new_t1_a ** 4))

            t2_eff_mu = base_t2_m_mu / base_t2_a_mu if base_t2_a_mu > 0 else 0
            if base_t2_a_mu > 0:
                t2_eff_var = (base_t2_m_var / (base_t2_a_mu ** 2)) + (((base_t2_m_mu ** 2) * base_t2_a_var) / (base_t2_a_mu ** 4))
            else:
                t2_eff_var = 0

            diff_eff_mu = new_t1_eff_mu - t2_eff_mu
            diff_eff_var = max(new_t1_eff_var + t2_eff_var, 0.00001)

            cat_pct_key = f"{cat}%"
            p_win = sp.stats.norm.sf(0, loc=diff_eff_mu, scale=np.sqrt(diff_eff_var))
            new_win_probs[cat_pct_key] = p_win

            p_base = baseline_win_probs.get(cat_pct_key, 0.5)
            cat_delta_p = p_win - p_base
            delta_e += cat_delta_p

            if cat_delta_p <= -0.04:
                rate_pct = (p_stats.get(f"mu_{cat}m") or 0) / (p_stats.get(f"mu_{cat}a") or 1) * 100
                risk_flags.append(f"Negative {cat.upper()}% impact ({rate_pct:.1f}%)")
            elif category_diagnostics[cat_pct_key]["target"] and cat_delta_p >= 0.03:
                base_t1_rate = base_t1_m_mu / base_t1_a_mu if base_t1_a_mu > 0 else 0
                rate_diff = (new_t1_eff_mu - base_t1_rate) * 100
                boosted_cats.append({
                    "cat": cat.upper() + "%",
                    "before_p": round(float(p_base), 3),
                    "after_p": round(float(p_win), 3),
                    "delta_p": round(float(cat_delta_p), 3),
                    "gain": f"{'+' if rate_diff >= 0 else ''}{rate_diff:.1f}%"
                })

        recommendations.append({
            "player": {
                "name": p_name,
                "nba_team": norm_team,
                "positions": p_stats.get("positions") or "Util",
                "z_total": round(float(p_stats.get("z_total") or 0), 2),
                "mu_pts": round(float(p_stats.get("mu_pts") or 0), 1),
                "mu_reb": round(float(p_stats.get("mu_reb") or 0), 1),
                "mu_ast": round(float(p_stats.get("mu_ast") or 0), 1),
                "mu_stl": round(float(p_stats.get("mu_stl") or 0), 1),
                "mu_blk": round(float(p_stats.get("mu_blk") or 0), 1),
                "mu_fg3m": round(float(p_stats.get("mu_fg3m") or 0), 1),
            },
            "action": roster_action,
            "schedule": {
                "games_remaining": total_games_in_window,
                "startable_games": startable_games,
                "startable_dates": startable_dates,
                "clashes": clashes,
            },
            "impact": {
                "expected_win_delta": round(float(delta_e), 3),
                "primary_boost_categories": boosted_cats,
                "risk_flags": risk_flags,
            }
        })

    # Sort by expected win delta descending
    recommendations.sort(key=lambda r: r["impact"]["expected_win_delta"], reverse=True)

    # Assign ranks
    final_recs = []
    for i, rec in enumerate(recommendations[:limit]):
        rec["rank"] = i + 1
        final_recs.append(rec)

    return {
        "matchup_diagnostics": {
            "current_score": baseline.get("accumulated_stats", {}).get("current_score", {}),
            "categories": category_diagnostics
        },
        "roster_action": roster_action,
        "recommendations": final_recs
    }
