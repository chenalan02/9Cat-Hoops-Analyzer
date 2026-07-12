import time
import numpy as np
import pandas as pd
import scipy as sp
import pulp

def _get_live_team_stats(yahoo_query, team_id, week_num):
    '''
    Makes a single raw API call to extract ALL 9-cat stats for a team, 
    mapping standard categories and splitting the raw FGM/FGA and FTM/FTA strings.
    '''
    team_key = f"{yahoo_query.get_league_key()}.t.{team_id}"
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
        if stat_id == "9004003" and value != "0":
            fgm, fga = value.split("/")
            live_stats["fgm"] = float(fgm)
            live_stats["fga"] = float(fga)

        elif stat_id == "9007006" and value != "0":
            ftm, fta = value.split("/")
            live_stats["ftm"] = float(ftm)
            live_stats["fta"] = float(fta)

        # 2. Handle the standard 9 categories
        elif stat_id in yahoo_stat_map:
            cat_name = yahoo_stat_map[stat_id]

            # Yahoo occasionally returns a dash ("-") or empty string if a team 
            # literally has 0 stats in a category early in the week.
            try:
                live_stats[cat_name] = float(value)
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


def _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule):
    '''
    Get game schedule for the week for both teams, then solve for the optimal lineup based on player stats and roster positions.
    '''
    # get game schedule for each player on both teams for the week
    team1_schedule = {}
    team2_schedule = {}

    date_start = pd.to_datetime(date_start)
    next_sunday = date_start + pd.DateOffset(days=(6 - pd.to_datetime(date_start).weekday()))

    nba_schedule['scheduled_date'] = pd.to_datetime(nba_schedule['scheduled_date'])
    nba_schedule = nba_schedule.set_index('scheduled_date').sort_index()
    nba_schedule = nba_schedule.loc[date_start:next_sunday]

    for date in pd.date_range(start=date_start, end=next_sunday, freq='D'):
        team1_schedule[date.strftime('%Y-%m-%d')] = {}
        team2_schedule[date.strftime('%Y-%m-%d')] = {}
        if date in nba_schedule.index:
            daily_schedule = nba_schedule.loc[[date]]
            games_info = daily_schedule.set_index('team').to_dict(orient='index')
        else:
            games_info = {}
        teams_set = set(games_info.keys())

        for player in team1["players"]:
            if player['nba_team'] in teams_set:
                team1_schedule[date.strftime('%Y-%m-%d')][player['name']] = games_info[player['nba_team']]
        for player in team2["players"]:
            if player['nba_team'] in teams_set:
                team2_schedule[date.strftime('%Y-%m-%d')][player['name']] = games_info[player['nba_team']]

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
                prob += (
                    pulp.lpSum(choices[(p_name, slot)] for slot in roster_slots) == 1,
                    f"Slot_{p_name.replace(' ', '_')}_one_slot" # Replacing spaces for cleaner PuLP logs
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
                    return slot_type in ["BN", "Util", "IL+", "IL"]
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
                player_stats = player_info[stats_source]
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
                        prob += (
                            choices[(player_name, slot)] == 0,
                            f"Eligibility_{player_name}_{slot}"
                        )
            
            prob += pulp.lpSum(objective_terms), "Total_Ranking_Score"

            # solve optimization problem and save results
            prob.solve(pulp.PULP_CBC_CMD(msg=False))
            
            for player_info in team["players"]:
                p_name = player_info['name']
                for slot in roster_slots:
                    if pulp.value(choices[(p_name, slot)]) == 1.0:
                        team_lineups[team_num][date.strftime('%Y-%m-%d')][slot] = p_name

    return team_lineups


def matchup_analysis(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule):
    '''
    Analyze the matchup between two teams for the week, considering their schedules and player stats.
    '''

    optimal_lineups = _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule)
    players_list = team1["players"] + team2["players"]
    players_dict = {player['name']: player for player in players_list}

    counting_stats = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
    efficiency_stats = ["fg", "ft"]

    def get_base_dist():
        return {stat: {"mu": 0, "var": 0} for stat in 
            ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fga", "fgm", "fta", "ftm"]}

    agg_dists = {
        "team1": get_base_dist(),
        "team2": get_base_dist()
    }

    # fill aggregate stats from previous games
    any_live_games = False
    for team in [team1, team2]:
        scoreboard, live_games = _get_live_team_stats(yahoo_query, team["team_id"], week_num)
        time.sleep(0.05)
        if live_games:
            any_live_games = True
        for stat, value in scoreboard.items():
            agg_dists["team1" if team == team1 else "team2"][stat]["mu"] = value

    # fill aggregate stats dists with probability dists
    for team_num, team in [("team1", team1), ("team2", team2)]:
        for date, lineup in optimal_lineups[team_num].items():
            for slot, player_name in lineup.items():
                player_info = players_dict[player_name]
                player_stats = player_info[stats_source]

                if slot.split("_")[0] not in ["BN", "Util", "IL", "IL+"] and player_stats["proj_games_played"] is not None:

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

        # Calculate probability that team1 outperforms team2 in this category
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
            team1_eff_var = (team1_m_var / (team1_a_mu ** 2)) - (((team1_m_mu ** 2) * team1_a_var) / (team1_a_mu ** 4))
        else:
            team1_eff_var = 0
            
        if team2_a_mu > 0:
            team2_eff_var = (team2_m_var / (team2_a_mu ** 2)) - (((team2_m_mu ** 2) * team2_a_var) / (team2_a_mu ** 4))
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

    return {"win_probs": win_probs, "agg_dists": agg_dists, "inactive_players": inactive_players}


def matchup_analysis_monte_carlo(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule, n_sims=10000):
    '''
    Analyze the matchup between two teams for the week, considering their schedules and player stats.
    '''
    optimal_lineups = _solve_optimal_lineup(team1, team2, date_start, roster_positions, stats_source, nba_schedule)
    players_list = team1["players"] + team2["players"]
    players_dict = {player['name']: player for player in players_list}

    counting_stats = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
    efficiency_stats = ["fg", "ft"]

    # fill aggregate stats from previous games
    agg_dists = {"team1": {}, "team2": {}}
    any_live_games = False
    for team in [team1, team2]:
        scoreboard, live_games = _get_live_team_stats(yahoo_query, team["team_id"], week_num)
        time.sleep(0.05)
        if live_games:
            any_live_games = True
        for stat, value in scoreboard.items():
            agg_dists["team1" if team == team1 else "team2"][stat] = value
    
    def get_base_dict(team):
        return {stat: np.full(n_sims, agg_dists[team][stat]) for stat in counting_stats + [f"{stat}a" for stat in efficiency_stats] + [f"{stat}m" for stat in efficiency_stats]}
    # aggrgegate counts for each category for each sim
    sim_agg = {"team1": get_base_dict("team1"),
               "team2": get_base_dict("team2")}

    win_counts = {}
    win_pcts = {}
    
    for team in ["team1", "team2"]:
        for date, lineup in optimal_lineups[team].items():
            sim_agg[team][date] = {}
            for slot, player_name in lineup.items():
                player_info = players_dict[player_name]
                player_stats = player_info[stats_source]

                if slot.split("_")[0] not in ["BN", "Util", "IL", "IL+"] and player_stats["proj_games_played"] is not None:
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

    # calculate win probabilities based on sims
    for cat in counting_stats:
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

    return {"win_pcts": win_pcts, "sim_avg": sim_avg, "inactive_players": inactive_players}