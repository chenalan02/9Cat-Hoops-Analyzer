import numpy as np
import pandas as pd

from backend.services import matchup_service, yahoo_client
from backend.services.lineup_solver import (
    can_play_active,
    can_play_slot,
    get_league_roster_slots,
    get_prepared_schedule,
    parse_positions,
    solve_day_lineup_matrix,
)
from backend.services.stats_utils import (
    CAT_DB_Z_KEYS,
    IR_SLOTS,
    OUT_TAGS,
    Q_TAGS,
    VEC_MU_KEYS,
    canonical_cat,
    compute_player_rank_score,
    extract_rank_and_z,
    get_safe_player_stats,
    normalize_nba_team,
    prob_positive,
    resolve_player_ros,
    stats_to_vec,
    weighted_cat_delta,
)
from backend.utils import clean_player_name

_COUNTING_STATS = ("pts", "reb", "ast", "stl", "blk", "tov", "fg3m")
_CAT_KEYS = ("pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fg%", "ft%")
_FIXED_9CAT_ORDER = ("pts", "reb", "ast", "stl", "blk", "fg3m", "fg%", "ft%", "tov")


def _compute_category_diagnostics(baseline_win_probs, baseline_proj, punted_set):
    category_diagnostics = {}
    for cat in _CAT_KEYS:
        p0 = baseline_win_probs.get(cat, 0.5)
        if cat in ("fg%", "ft%"):
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

        is_punted = cat in punted_set
        if is_punted:
            status, target = "PUNTED", False
        elif p0 >= 0.85:
            status, target = "SAFE", False
        elif p0 <= 0.15:
            status, target = "DOOMED", False
        else:
            status, target = "SWING", True

        category_diagnostics[cat] = {
            "status": status,
            "p_win": round(float(p0), 4),
            "margin": round(float(margin), 2),
            "target": target,
            "is_punted": is_punted,
        }
    return category_diagnostics


def _adjacent_b2b_pairs(dates_list):
    if len(dates_list) < 2:
        return []
    sorted_d = sorted(dates_list)
    pairs = []
    for i in range(len(sorted_d) - 1):
        if (pd.to_datetime(sorted_d[i + 1]) - pd.to_datetime(sorted_d[i])).days == 1:
            pairs.append([sorted_d[i], sorted_d[i + 1]])
    return pairs


def _build_action_for_eval(ev, window_label, open_roster_spots, open_il_slots, fa_benchmark_z):
    bp_name = ev["player"].get("name")
    bp_status = ev["status"]
    bp_starts = ev["starts"]
    bp_z = ev["z"]
    bp_de = ev["max_delta_e"]
    bp_ros = ev["ros_rank"]
    bp_tier = ev["hold_tier"]
    starts_plural = "s" if bp_starts != 1 else ""

    if open_il_slots > 0 and bp_status in OUT_TAGS:
        act_type = "MOVE_TO_IR"
        reason = (
            f"Suggested: Move {bp_name} ({bp_status} tag, not in IR) to open IL slot "
            f"({bp_starts} start{starts_plural} {window_label}) to add a streamer with 0 drops."
        )
    elif bp_status in OUT_TAGS or bp_status in Q_TAGS:
        act_type = "TAGGED_SUGGESTION"
        reason = (
            f"Suggested: Bench / swap {bp_name} ({bp_status} tag — "
            f"{bp_starts} projected start{starts_plural} {window_label}, Z: {bp_z:+.2f})."
        )
    elif bp_tier == "MUST_HOLD":
        act_type = "HOLD_WARNING"
        ros_txt = f"ROS #{bp_ros}" if bp_ros else (f"ROS Z: {ev['ros_z']:+.2f}" if ev.get("ros_z") is not None else f"Z: {bp_z:+.2f}")
        reason = (
            f"Hold Caution: Dropping {bp_name} ({ros_txt}) sacrifices strong Rest-of-Season value "
            f"for a short-term pickup (ΔE: {bp_de:+.2f}). Only stream in must-win / playoff spots."
        )
    elif bp_z > fa_benchmark_z + 1.25 and bp_tier == "CORE_HOLD":
        act_type = "HOLD_WARNING"
        ros_txt = f"ROS #{bp_ros}" if bp_ros else f"Z: {bp_z:+.2f}"
        reason = (
            f"Hold Caution: {bp_name} ({ros_txt}, {bp_starts} start{starts_plural} {window_label}) "
            f"exceeds Free Agent baseline (Z: {fa_benchmark_z:+.2f})."
        )
    else:
        act_type = "DROP"
        reason = (
            f"Suggested: Replace {bp_name} (Z: {bp_z:+.2f}, {bp_starts} start{starts_plural} {window_label}) "
            f"— yields net category win probability gain (ΔE: {bp_de:+.2f})."
        )

    return {
        "type": act_type,
        "target_player": bp_name,
        "status_tag": bp_status or None,
        "drop_z": round(bp_z, 2),
        "ros_rank": bp_ros,
        "hold_tier": bp_tier,
        "drop_starts": bp_starts,
        "open_roster_spots": open_roster_spots,
        "open_il_slots": open_il_slots,
        "fa_benchmark_z": round(fa_benchmark_z, 2),
        "reason": reason,
    }


def _finalize_rec_list(raw_recs, action_obj, drop_details, rec_limit):
    beneficial = [r for r in raw_recs if r["impact"]["expected_win_delta"] > 0]
    has_pos = len(beneficial) > 0
    source_slice = beneficial[:rec_limit] if has_pos else raw_recs[:rec_limit]
    out = []
    for idx, rec in enumerate(source_slice):
        copy_rec = dict(rec)
        copy_rec["action"] = action_obj
        if drop_details is None and not copy_rec.get("vs_drop"):
            copy_rec["drop_player"] = None
        copy_rec["rank"] = (idx + 1) if has_pos else None
        copy_rec["is_beneficial"] = has_pos
        copy_rec["is_negative"] = not has_pos
        out.append(copy_rec)
    return out, has_pos


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
    limit=6,
    target_drop_player=None,
    pickup_mode="week",
    punted_cats=None,
    ros_stats_pool=None,
):
    pickup_mode = "today" if str(pickup_mode or "").lower().strip() == "today" else "week"
    punted_set = {canonical_cat(c) for c in (punted_cats or []) if canonical_cat(c)}
    date_start_dt = pd.to_datetime(date_start).tz_localize(None)
    today_dt = date_start_dt.floor("D")
    today_str = today_dt.strftime("%Y-%m-%d")
    next_sunday = (today_dt + pd.Timedelta(days=(6 - today_dt.weekday()))).floor("D")

    week_date_strings = [d.strftime("%Y-%m-%d") for d in pd.date_range(start=today_dt, end=next_sunday, freq="D")]
    window_date_strings = [today_str] if pickup_mode == "today" else week_date_strings
    window_date_set = set(window_date_strings)

    baseline = matchup_service.matchup_analysis(
        yahoo_query=yahoo_query,
        team1=team1,
        team2=team2,
        week_num=week_num,
        date_start=date_start,
        roster_positions=roster_positions,
        stats_source=stats_source,
        nba_schedule=nba_schedule,
    )

    baseline_win_probs = baseline.get("win_probs", {})
    baseline_proj = baseline.get("analytical_projections") or baseline.get("agg_dists", {})
    optimal_lineups = baseline.get("optimal_lineups", {})
    team_schedules = baseline.get("team_schedules", {})
    player_games_t1 = baseline.get("player_games", {}).get("team1", {})

    category_diagnostics = _compute_category_diagnostics(baseline_win_probs, baseline_proj, punted_set)

    active_slots, inactive_slots = get_league_roster_slots(roster_positions)
    active_slots_set = set(active_slots)
    bn_slots = [s for s in inactive_slots if s.split("_")[0].upper() == "BN"]
    il_slots = [s for s in inactive_slots if s.split("_")[0].upper() in ("IL", "IL+", "IR", "IR+")]
    standard_capacity = len(active_slots) + len(bn_slots)

    t1_players = [
        p for p in team1.get("players", [])
        if str(p.get("selected_position") or "").upper() not in IR_SLOTS
    ]
    occupied_il_slots = sum(
        1 for p in team1.get("players", [])
        if str(p.get("selected_position") or "").upper() in ("IL", "IL+", "IR", "IR+")
    )
    open_il_slots = max(0, len(il_slots) - occupied_il_slots)
    open_roster_spots = max(0, standard_capacity - len(t1_players)) if standard_capacity > 0 else 0

    def get_player_starts(player_name, dates_filter=None):
        target_dates = set(dates_filter if dates_filter is not None else window_date_strings)
        t1_lineups = optimal_lineups.get("team1", {})
        t1_sched = team_schedules.get("team1", {})
        if t1_lineups:
            starts = 0
            for d, lineup in t1_lineups.items():
                if d not in target_dates:
                    continue
                players_with_game = t1_sched.get(d, {})
                if player_name in players_with_game:
                    for slot, p_in_slot in lineup.items():
                        if slot in active_slots_set and p_in_slot == player_name:
                            starts += 1
                            break
            return starts
        p_g = player_games_t1.get(player_name, {})
        if str(p_g.get("status") or "").upper() in OUT_TAGS:
            return 0
        if dates_filter is not None and len(target_dates) == 1:
            return min(1, int(p_g.get("remaining", 0) or 0))
        return int(p_g.get("remaining", 0) or 0)

    sched = get_prepared_schedule(nba_schedule)
    week_sched = sched[(sched["scheduled_date"] >= today_dt) & (sched["scheduled_date"] <= next_sunday)]
    team_week_game_dates = {
        team_abbr: set(group["scheduled_date"].dt.strftime("%Y-%m-%d"))
        for team_abbr, group in week_sched.groupby("team_normalized")
    }
    team_game_dates = {
        team_abbr: (dates & window_date_set)
        for team_abbr, dates in team_week_game_dates.items()
    }

    if all_rostered_names is None:
        all_rostered_names = {p["name"] for p in (team1.get("players", []) + team2.get("players", []))}
    else:
        all_rostered_names = set(all_rostered_names)

    fa_info_map = yahoo_client.get_yahoo_fa_info_map(yahoo_query)
    fa_status_map = {
        k: (v.get("status", "") if isinstance(v, dict) else str(v))
        for k, v in fa_info_map.items()
    }
    resolve_player_positions = yahoo_client.build_position_resolver(
        yahoo_query=yahoo_query,
        fa_info_map=fa_info_map,
        teams=[team1, team2],
    )

    def get_punt_z_from_stats(stats_dict, fallback_z=0.0):
        if not stats_dict:
            return float(fallback_z or 0.0)
        if not punted_set and stats_dict.get("z_total") is not None:
            return float(stats_dict["z_total"])
        z_sum = 0.0
        found_any = False
        for c in _CAT_KEYS:
            if c in punted_set:
                continue
            zk = CAT_DB_Z_KEYS.get(c)
            if zk and stats_dict.get(zk) is not None:
                z_sum += float(stats_dict[zk])
                found_any = True
        if found_any:
            return z_sum
        return float(stats_dict.get("z_total") if stats_dict.get("z_total") is not None else fallback_z or 0.0)

    def get_swing_z_from_stats(stats_dict):
        if not stats_dict:
            return 0.0
        z_sum = 0.0
        for c, diag in category_diagnostics.items():
            if diag["status"] != "SWING":
                continue
            zk = CAT_DB_Z_KEYS.get(c)
            if zk and stats_dict.get(zk) is not None:
                z_sum += float(stats_dict[zk])
        return z_sum

    fa_candidates = []
    for p_name, p_stats in (player_stats_pool or {}).items():
        if p_name in all_rostered_names:
            continue
        if (p_stats.get("games_played") or 0) < 3 or (p_stats.get("mu_min") or 0) < 13.0:
            continue

        clean_name = clean_player_name(p_name)
        yahoo_status = (
            fa_status_map.get(clean_name)
            or fa_status_map.get(p_name)
            or fa_status_map.get(clean_name.lower())
            or fa_status_map.get(p_name.lower())
            or ""
        )
        db_status = str(p_stats.get("status") or p_stats.get("injury_status") or "").upper().strip()
        if yahoo_status in OUT_TAGS or db_status in OUT_TAGS:
            continue

        proj_gp = p_stats.get("proj_games_played")
        if proj_gp is not None:
            try:
                if float(proj_gp) <= 0:
                    continue
            except (ValueError, TypeError):
                pass
        elif stats_source in ("weekly_stats", "weekly_rankings") and p_stats.get("is_ema_fallback", False):
            continue

        raw_team = p_stats.get("team")
        if not raw_team:
            continue
        norm_team = normalize_nba_team(raw_team)
        win_games = len(team_game_dates.get(norm_team, set()))
        if win_games == 0:
            continue

        cand_punt_z = get_punt_z_from_stats(p_stats, p_stats.get("z_total"))
        cand_swing_z = get_swing_z_from_stats(p_stats)
        fa_candidates.append({
            "name": p_name,
            "norm_team": norm_team,
            "stats": p_stats,
            "status": yahoo_status or db_status or None,
            "win_games": win_games,
            "punt_z": cand_punt_z,
            "swing_z": cand_swing_z,
            "sched_score": win_games * max(0.5, 4.0 + cand_punt_z),
            "specialist_score": min(win_games, 4) * cand_swing_z,
        })

    by_punt_z = sorted(fa_candidates, key=lambda c: c["punt_z"], reverse=True)[:60]
    by_sched = sorted(fa_candidates, key=lambda c: c["sched_score"], reverse=True)[:45]
    by_specialist = sorted(fa_candidates, key=lambda c: c["specialist_score"], reverse=True)[:35]

    seen_fa_names = set()
    top_fa_pool = []
    for bucket in (by_punt_z, by_sched, by_specialist):
        for item in bucket:
            if item["name"] not in seen_fa_names:
                seen_fa_names.add(item["name"])
                top_fa_pool.append(item)
                if len(top_fa_pool) >= 120:
                    break
        if len(top_fa_pool) >= 120:
            break

    top_fa_zs = [x["punt_z"] for x in by_punt_z[:5]]
    fa_benchmark_z = float(np.mean(top_fa_zs)) if top_fa_zs else -3.5

    def get_player_z(p):
        src_dict = (p.get(stats_source) or {}) if isinstance(p, dict) else {}
        if punted_set and src_dict:
            return get_punt_z_from_stats(src_dict)
        val = (
            src_dict.get("z_total")
            if src_dict.get("z_total") is not None
            else p.get("z_total")
            if p.get("z_total") is not None
            else (p.get("ema_stats") or {}).get("z_total")
        )
        return float(val) if val is not None else 0.0

    date_strings = window_date_strings
    t1_lineups = optimal_lineups.get("team1", {})
    t1_sched = team_schedules.get("team1", {})
    window_label = "today" if pickup_mode == "today" else "left this week"

    t1_vec_by_name = {}
    t1_meta_by_name = {}
    for p in t1_players:
        p_name = p.get("name")
        p_stats = get_safe_player_stats(p, stats_source)
        p_pos = parse_positions(p.get("positions"))
        p_status = p.get("status")
        sel_pos = p.get("selected_position")
        mask = tuple(can_play_active(p_pos, p_status, s, sel_pos) for s in active_slots)
        t1_vec_by_name[p_name] = stats_to_vec(p_stats)
        t1_meta_by_name[p_name] = {
            "name": p_name,
            "slot_mask": mask,
            "rank_score": compute_player_rank_score(p, p_stats, stats_source),
            "is_eligible_any": any(mask),
        }

    base_day_starters = {}
    base_window_vec = np.zeros(22, dtype=np.float64)
    base_total_starts = 0
    for d_str in date_strings:
        lineup = t1_lineups.get(d_str, {})
        players_with_game = t1_sched.get(d_str, {})
        starters = set()
        d_vec = np.zeros(22, dtype=np.float64)
        for slot, assigned_p in lineup.items():
            if slot in active_slots_set and assigned_p and assigned_p in players_with_game:
                starters.add(assigned_p)
                if assigned_p in t1_vec_by_name:
                    d_vec += t1_vec_by_name[assigned_p]
        base_day_starters[d_str] = starters
        base_window_vec += d_vec
        base_total_starts += len(starters)

    base_t1_mu_arr = {c: float(baseline_proj.get("team1", {}).get(c, {}).get("mu", 0.0)) for c in VEC_MU_KEYS}
    base_t1_var_arr = {c: float(baseline_proj.get("team1", {}).get(c, {}).get("var", 0.0)) for c in VEC_MU_KEYS}
    base_t2_mu_arr = {c: float(baseline_proj.get("team2", {}).get(c, {}).get("mu", 0.0)) for c in VEC_MU_KEYS}
    base_t2_var_arr = {c: float(baseline_proj.get("team2", {}).get(c, {}).get("var", 0.0)) for c in VEC_MU_KEYS}

    base_t2_eff = {}
    for cat in ("fg", "ft"):
        m2, a2 = base_t2_mu_arr[f"{cat}m"], base_t2_mu_arr[f"{cat}a"]
        mv2, av2 = base_t2_var_arr[f"{cat}m"], base_t2_var_arr[f"{cat}a"]
        e2_mu = m2 / a2 if a2 > 0 else 0.0
        e2_var = ((mv2 / (a2 ** 2)) + (((m2 ** 2) * av2) / (a2 ** 4))) if a2 > 0 else 0.0
        base_t2_eff[cat] = (e2_mu, e2_var)

    fa_prepared = []
    for item in top_fa_pool:
        p_name = item["name"]
        p_stats = item["stats"]
        cand_status = item["status"]
        resolved_pos = resolve_player_positions(p_name, p_stats, allow_yahoo_lookup=False)
        fa_mask = tuple(can_play_slot(parse_positions(resolved_pos), s) for s in active_slots)
        if not any(fa_mask):
            continue

        play_prob = 0.25 if cand_status == "DOUBTFUL" else (0.75 if (cand_status and cand_status in Q_TAGS) else 1.0)
        fa_vec = stats_to_vec(p_stats)
        fa_contrib_vec = np.zeros(22, dtype=np.float64)
        fa_contrib_vec[:11] = play_prob * fa_vec[:11]
        # Include Bernoulli mixture variance p*(1-p)*mu^2 so questionable pickups carry realistic risk.
        fa_contrib_vec[11:] = play_prob * fa_vec[11:] + play_prob * (1.0 - play_prob) * (fa_vec[:11] ** 2)

        raw_rank_score = compute_player_rank_score({"name": p_name}, p_stats, stats_source)
        fa_eff_rank_score = raw_rank_score * (0.85 if play_prob < 0.5 else (0.94 if play_prob < 1.0 else 1.0))

        ros_rank, ros_z, fa_hold_tier = resolve_player_ros(
            p_name=p_name,
            player_obj=None,
            ros_stats_pool=ros_stats_pool,
            fallback_stats=None,
        )
        cand_rank, _ = extract_rank_and_z(p_stats)
        fa_prepared.append({
            **item,
            "resolved_pos": resolved_pos,
            "slot_mask": fa_mask,
            "play_prob": play_prob,
            "fa_contrib_vec": fa_contrib_vec,
            "eff_rank_score": fa_eff_rank_score,
            "cand_rank": cand_rank,
            "ros_rank": ros_rank,
            "ros_z": round(float(ros_z), 2) if ros_z is not None else None,
            "is_ros_hold": fa_hold_tier != "STREAMABLE",
        })

    def evaluate_candidate_for_drop(drop_p):
        drop_name = drop_p.get("name") if drop_p else None
        drop_p_starts = get_player_starts(drop_name, window_date_strings) if drop_name else 0
        drop_p_stats = get_safe_player_stats(drop_p, stats_source) if drop_p else None

        drop_p_details = None
        if drop_p and drop_p_stats:
            drop_fgm = float(drop_p_stats.get("mu_fgm") or 0.0)
            drop_fga = float(drop_p_stats.get("mu_fga") or 0.0)
            drop_ftm = float(drop_p_stats.get("mu_ftm") or 0.0)
            drop_fta = float(drop_p_stats.get("mu_fta") or 0.0)
            drop_fg_pct = round((drop_fgm / drop_fga) * 100, 1) if drop_fga > 0 else 0.0
            drop_ft_pct = round((drop_ftm / drop_fta) * 100, 1) if drop_fta > 0 else 0.0
            drop_z_val = get_player_z(drop_p)
            drop_rank, _ = extract_rank_and_z(drop_p_stats)
            if drop_rank is None:
                drop_rank, _ = extract_rank_and_z(drop_p)
            d_ros_rank, d_ros_z, d_hold_tier = resolve_player_ros(
                p_name=drop_name,
                player_obj=drop_p,
                ros_stats_pool=ros_stats_pool,
                fallback_stats=drop_p_stats,
            )

            drop_p_details = {
                "name": drop_name,
                "rank": drop_rank,
                "ros_rank": d_ros_rank,
                "ros_z": round(float(d_ros_z), 2) if d_ros_z is not None else None,
                "hold_tier": d_hold_tier,
                "nba_team": normalize_nba_team(drop_p.get("nba_team")),
                "positions": (
                    drop_p.get("positions")
                    if drop_p.get("positions") and str(drop_p.get("positions")).upper() != "UTIL"
                    else resolve_player_positions(drop_name, drop_p_stats, allow_yahoo_lookup=False)
                ),
                "status": drop_p.get("status") or None,
                "selected_position": drop_p.get("selected_position") or None,
                "z_total": round(drop_z_val, 2),
                "starts": drop_p_starts,
                "mu_pts": round(float(drop_p_stats.get("mu_pts") or 0.0), 1),
                "mu_reb": round(float(drop_p_stats.get("mu_reb") or 0.0), 1),
                "mu_ast": round(float(drop_p_stats.get("mu_ast") or 0.0), 1),
                "mu_stl": round(float(drop_p_stats.get("mu_stl") or 0.0), 1),
                "mu_blk": round(float(drop_p_stats.get("mu_blk") or 0.0), 1),
                "mu_fg3m": round(float(drop_p_stats.get("mu_fg3m") or 0.0), 1),
                "mu_tov": round(float(drop_p_stats.get("mu_tov") or 0.0), 1),
                "fg_pct": drop_fg_pct,
                "ft_pct": drop_ft_pct,
                "mu_fgm": round(drop_fgm, 1),
                "mu_fga": round(drop_fga, 1),
                "mu_ftm": round(drop_ftm, 1),
                "mu_fta": round(drop_fta, 1),
            }

        rem_meta_by_date = {}
        without_drop_vec = {}
        without_drop_starters = {}
        without_drop_open_slot_idxs = {}
        without_drop_min_rank = {}
        bench_backfill_map = {}

        for d_str in date_strings:
            players_with_game = t1_sched.get(d_str, {})
            d_metas = []
            for p in t1_players:
                pn = p.get("name")
                if (drop_name and pn == drop_name) or pn not in players_with_game:
                    continue
                m = t1_meta_by_name.get(pn)
                if m and m["is_eligible_any"]:
                    d_metas.append(m)

            assigns = solve_day_lineup_matrix(d_metas, active_slots)
            used_slots = {active_slots.index(s_name) for s_name, _ in assigns}
            open_idxs = [i for i in range(len(active_slots)) if i not in used_slots]
            starter_names = {d_metas[p_i]["name"] for _, p_i in assigns}
            d_vec = np.zeros(22, dtype=np.float64)
            min_r = float("inf")
            for _, p_i in assigns:
                sn = d_metas[p_i]["name"]
                d_vec += t1_vec_by_name[sn]
                if d_metas[p_i]["rank_score"] < min_r:
                    min_r = d_metas[p_i]["rank_score"]

            rem_meta_by_date[d_str] = d_metas
            without_drop_open_slot_idxs[d_str] = open_idxs
            without_drop_starters[d_str] = starter_names
            without_drop_vec[d_str] = d_vec
            without_drop_min_rank[d_str] = min_r
            backfills = starter_names - base_day_starters[d_str]
            if backfills:
                bench_backfill_map[d_str] = sorted(backfills)

        day_solve_cache = {}
        pool_recs = []

        for fa in fa_prepared:
            p_name = fa["name"]
            norm_team = fa["norm_team"]
            p_stats = fa["stats"]
            cand_status = fa["status"]
            fa_mask = fa["slot_mask"]
            fa_eff_rank = fa["eff_rank_score"]
            play_prob = fa["play_prob"]
            s_dates = team_game_dates.get(norm_team, set())

            startable_dates = []
            clashed_dates = []
            all_game_dates = [d for d in date_strings if d in s_dates]
            replaced_starters_notes = []

            after_window_vec = np.zeros(22, dtype=np.float64)
            after_total_starts = 0

            for d_str in date_strings:
                if d_str not in s_dates:
                    after_window_vec += without_drop_vec[d_str]
                    after_total_starts += len(without_drop_starters[d_str])
                    continue

                open_idxs = without_drop_open_slot_idxs[d_str]
                if any(fa_mask[s_idx] for s_idx in open_idxs):
                    startable_dates.append(d_str)
                    after_window_vec += without_drop_vec[d_str] + fa["fa_contrib_vec"]
                    after_total_starts += len(without_drop_starters[d_str]) + 1
                    continue

                if not open_idxs and fa_eff_rank <= without_drop_min_rank[d_str]:
                    clashed_dates.append(d_str)
                    after_window_vec += without_drop_vec[d_str]
                    after_total_starts += len(without_drop_starters[d_str])
                    continue

                cache_key = (d_str, fa_mask, round(fa_eff_rank, 2))
                cached = day_solve_cache.get(cache_key)
                if cached is None:
                    d_metas = rem_meta_by_date[d_str]
                    fa_idx = len(d_metas)
                    combined = d_metas + [{
                        "name": p_name,
                        "slot_mask": fa_mask,
                        "rank_score": fa_eff_rank,
                    }]
                    assigns = solve_day_lineup_matrix(combined, active_slots)
                    fa_in = False
                    others_vec = np.zeros(22, dtype=np.float64)
                    others_names = set()
                    for _, p_i in assigns:
                        if p_i == fa_idx:
                            fa_in = True
                        else:
                            oname = combined[p_i]["name"]
                            others_names.add(oname)
                            others_vec += t1_vec_by_name[oname]
                    cached = (fa_in, others_vec, others_names)
                    day_solve_cache[cache_key] = cached

                fa_in, others_vec, others_names = cached
                if fa_in:
                    startable_dates.append(d_str)
                    after_window_vec += others_vec + fa["fa_contrib_vec"]
                    after_total_starts += len(others_names) + 1
                    bumped = without_drop_starters[d_str] - others_names
                    if bumped:
                        replaced_starters_notes.append(f"{d_str}: starts over {', '.join(sorted(bumped))}")
                else:
                    clashed_dates.append(d_str)
                    after_window_vec += without_drop_vec[d_str]
                    after_total_starts += len(without_drop_starters[d_str])

            startable_games = len(startable_dates)
            if startable_games == 0:
                continue

            week_dates_for_team = sorted(d for d in team_week_game_dates.get(norm_team, set()) if d > today_str)
            b2b_pairs = _adjacent_b2b_pairs(startable_dates if pickup_mode == "week" else sorted([today_str] + week_dates_for_team))
            backfill_count = len(bench_backfill_map)
            net_team_starts = after_total_starts - base_total_starts
            delta_vec = after_window_vec - base_window_vec

            cat_impacts = {}
            risk_flags = []
            if cand_status and cand_status in Q_TAGS:
                risk_flags.append(f"Injury status: {cand_status} (~{int(round(play_prob * 100))}% play est.)")
            if replaced_starters_notes:
                risk_flags.append(f"Lineup swap ({replaced_starters_notes[0]})")

            delta_e = 0.0
            raw_delta_e = 0.0

            for idx_c, cat in enumerate(_COUNTING_STATS):
                d_mu = float(delta_vec[idx_c])
                d_var = float(delta_vec[11 + idx_c])
                new_t1_mu = base_t1_mu_arr[cat] + d_mu
                new_t1_var = max(0.01, base_t1_var_arr[cat] + d_var)
                diff_mu = new_t1_mu - base_t2_mu_arr[cat]
                diff_var = max(0.01, new_t1_var + base_t2_var_arr[cat])

                p_win = prob_positive(-diff_mu if cat == "tov" else diff_mu, diff_var)
                p_base = baseline_win_probs.get(cat, 0.5)
                cat_delta_p = p_win - p_base
                diag_status = category_diagnostics[cat]["status"]

                if not category_diagnostics[cat]["is_punted"]:
                    raw_delta_e += cat_delta_p
                delta_e += weighted_cat_delta(p_base, p_win, diag_status)

                disp_cat = "3PM" if cat == "fg3m" else ("TO" if cat == "tov" else cat.upper())
                cat_impacts[cat] = {
                    "cat": disp_cat,
                    "before_p": round(float(p_base), 3),
                    "after_p": round(float(p_win), 3),
                    "delta_p": round(float(cat_delta_p), 3),
                    "is_target": bool(category_diagnostics[cat]["target"]),
                    "is_punted": bool(category_diagnostics[cat]["is_punted"]),
                    "gain": f"{'+' if d_mu >= 0 else ''}{d_mu:.1f}",
                }

                if cat == "tov" and not category_diagnostics[cat]["is_punted"] and cat_delta_p <= -0.04:
                    risk_flags.append(f"Turnover Risk ({d_mu:+.1f} TO)")

            for eff_idx, cat in enumerate(("fg", "ft")):
                m_idx = 7 + eff_idx * 2
                a_idx = m_idx + 1
                new_t1_m = max(0.0, base_t1_mu_arr[f"{cat}m"] + float(delta_vec[m_idx]))
                new_t1_m_var = max(0.01, base_t1_var_arr[f"{cat}m"] + float(delta_vec[11 + m_idx]))
                new_t1_a = max(0.01, base_t1_mu_arr[f"{cat}a"] + float(delta_vec[a_idx]))
                new_t1_a_var = max(0.01, base_t1_var_arr[f"{cat}a"] + float(delta_vec[11 + a_idx]))

                new_t1_eff_mu = new_t1_m / new_t1_a
                new_t1_eff_var = (new_t1_m_var / (new_t1_a ** 2)) + (((new_t1_m ** 2) * new_t1_a_var) / (new_t1_a ** 4))
                t2_eff_mu, t2_eff_var = base_t2_eff[cat]

                diff_eff_mu = new_t1_eff_mu - t2_eff_mu
                diff_eff_var = max(new_t1_eff_var + t2_eff_var, 0.00001)

                cat_pct_key = f"{cat}%"
                p_win = prob_positive(diff_eff_mu, diff_eff_var)
                p_base = baseline_win_probs.get(cat_pct_key, 0.5)
                cat_delta_p = p_win - p_base
                diag_status = category_diagnostics[cat_pct_key]["status"]

                if not category_diagnostics[cat_pct_key]["is_punted"]:
                    raw_delta_e += cat_delta_p
                delta_e += weighted_cat_delta(p_base, p_win, diag_status)

                b_m, b_a = base_t1_mu_arr[f"{cat}m"], base_t1_mu_arr[f"{cat}a"]
                base_t1_rate = b_m / b_a if b_a > 0 else new_t1_eff_mu
                rate_diff = (new_t1_eff_mu - base_t1_rate) * 100

                if not category_diagnostics[cat_pct_key]["is_punted"] and cat_delta_p <= -0.04:
                    fa_a = float(p_stats.get(f"mu_{cat}a") or 0)
                    rate_pct = ((float(p_stats.get(f"mu_{cat}m") or 0) / fa_a) * 100) if fa_a > 0 else 0.0
                    risk_flags.append(f"Negative {cat.upper()}% impact ({rate_pct:.1f}%)")

                cat_impacts[cat_pct_key] = {
                    "cat": f"{cat.upper()}%",
                    "before_p": round(float(p_base), 3),
                    "after_p": round(float(p_win), 3),
                    "delta_p": round(float(cat_delta_p), 3),
                    "is_target": bool(category_diagnostics[cat_pct_key]["target"]),
                    "is_punted": bool(category_diagnostics[cat_pct_key]["is_punted"]),
                    "gain": f"{'+' if rate_diff >= 0 else ''}{rate_diff:.2f}%",
                }

            boosted_cats = [cat_impacts[k] for k in _FIXED_9CAT_ORDER if k in cat_impacts]
            fgm_pg = float(p_stats.get("mu_fgm") or 0.0)
            fga_pg = float(p_stats.get("mu_fga") or 0.0)
            ftm_pg = float(p_stats.get("mu_ftm") or 0.0)
            fta_pg = float(p_stats.get("mu_fta") or 0.0)
            fg_pct_pg = round((fgm_pg / fga_pg) * 100, 1) if fga_pg > 0 else 0.0
            ft_pct_pg = round((ftm_pg / fta_pg) * 100, 1) if fta_pg > 0 else 0.0

            vs_drop = None
            if drop_p and drop_p_details:
                stat_diffs = {}
                for idx_c, c in enumerate(("pts", "reb", "ast", "stl", "blk", "fg3m", "tov")):
                    s_val = float(p_stats.get(f"mu_{c}") or 0.0)
                    d_val = float(drop_p_stats.get(f"mu_{c}") or 0.0)
                    stat_diffs[c] = {
                        "streamer_pg": round(s_val, 1),
                        "drop_pg": round(d_val, 1),
                        "diff_pg": round(s_val - d_val, 1),
                        "net_weekly": round(float(delta_vec[idx_c]), 1),
                    }
                stat_diffs["fg_pct"] = {
                    "streamer": fg_pct_pg,
                    "drop": drop_p_details["fg_pct"],
                    "diff": round(fg_pct_pg - drop_p_details["fg_pct"], 1),
                    "streamer_fgm": round(fgm_pg, 1),
                    "streamer_fga": round(fga_pg, 1),
                    "drop_fgm": round(drop_fgm, 1),
                    "drop_fga": round(drop_fga, 1),
                    "diff_fga": round(fga_pg - drop_fga, 1),
                }
                stat_diffs["ft_pct"] = {
                    "streamer": ft_pct_pg,
                    "drop": drop_p_details["ft_pct"],
                    "diff": round(ft_pct_pg - drop_p_details["ft_pct"], 1),
                    "streamer_ftm": round(ftm_pg, 1),
                    "streamer_fta": round(fta_pg, 1),
                    "drop_ftm": round(drop_ftm, 1),
                    "drop_fta": round(drop_fta, 1),
                    "diff_fta": round(fta_pg - drop_fta, 1),
                }
                vs_drop = {
                    "drop_name": drop_name,
                    "drop_team": drop_p_details["nba_team"],
                    "drop_starts": drop_p_starts,
                    "streamer_starts": startable_games,
                    "net_starts": net_team_starts,
                    "z_diff": round(fa["punt_z"] - drop_p_details["z_total"], 2),
                    "stats": stat_diffs,
                }

            pool_recs.append({
                "player": {
                    "name": p_name,
                    "status": cand_status,
                    "play_prob": play_prob,
                    "rank": fa["cand_rank"],
                    "ros_rank": fa["ros_rank"],
                    "ros_z": fa["ros_z"],
                    "is_ros_hold": fa["is_ros_hold"],
                    "nba_team": norm_team,
                    "positions": fa["resolved_pos"],
                    "z_total": round(fa["punt_z"], 2),
                    "mu_pts": round(float(p_stats.get("mu_pts") or 0), 1),
                    "mu_reb": round(float(p_stats.get("mu_reb") or 0), 1),
                    "mu_ast": round(float(p_stats.get("mu_ast") or 0), 1),
                    "mu_stl": round(float(p_stats.get("mu_stl") or 0), 1),
                    "mu_blk": round(float(p_stats.get("mu_blk") or 0), 1),
                    "mu_fg3m": round(float(p_stats.get("mu_fg3m") or 0), 1),
                    "mu_tov": round(float(p_stats.get("mu_tov") or 0), 1),
                    "fg_pct": fg_pct_pg,
                    "ft_pct": ft_pct_pg,
                    "mu_fgm": round(fgm_pg, 1),
                    "mu_fga": round(fga_pg, 1),
                    "mu_ftm": round(ftm_pg, 1),
                    "mu_fta": round(fta_pg, 1),
                },
                "schedule": {
                    "games_remaining": len(all_game_dates),
                    "startable_games": startable_games,
                    "startable_dates": startable_dates,
                    "clashed_dates": clashed_dates,
                    "all_game_dates": all_game_dates,
                    "back_to_back_pairs": b2b_pairs,
                    "rest_of_week_dates": week_dates_for_team,
                    "bench_backfill_games": backfill_count,
                    "net_team_starts": net_team_starts,
                    "clashes": len(clashed_dates),
                },
                "impact": {
                    "expected_win_delta": round(float(delta_e), 3),
                    "raw_win_delta": round(float(raw_delta_e), 3),
                    "primary_boost_categories": boosted_cats,
                    "risk_flags": risk_flags,
                },
                "drop_player": drop_p_details,
                "vs_drop": vs_drop,
            })

        pool_recs.sort(
            key=lambda r: (
                r["impact"]["expected_win_delta"],
                r["schedule"]["startable_games"],
                r["player"]["z_total"],
            ),
            reverse=True,
        )
        max_de = pool_recs[0]["impact"]["expected_win_delta"] if pool_recs else -999.0
        return pool_recs, max_de, drop_p_details

    cand_max_de_map = {}
    candidate_evals = []
    for cand in t1_players:
        c_recs, c_max_de, c_details = evaluate_candidate_for_drop(cand)
        c_starts = get_player_starts(cand.get("name"), window_date_strings)
        c_z = get_player_z(cand)
        candidate_evals.append({
            "player": cand,
            "recs": c_recs,
            "max_delta_e": c_max_de,
            "details": c_details,
            "starts": c_starts,
            "z": c_z,
            "ros_rank": c_details.get("ros_rank") if c_details else None,
            "ros_z": c_details.get("ros_z") if c_details else None,
            "hold_tier": c_details.get("hold_tier", "STREAMABLE") if c_details else "STREAMABLE",
            "status": str(cand.get("status") or "").upper().strip(),
        })
        cand_max_de_map[cand.get("name")] = c_max_de

    ir_move_evals = [
        e for e in candidate_evals
        if e["max_delta_e"] > 0 and open_il_slots > 0 and e["status"] in OUT_TAGS
    ]
    safe_positive_evals = [
        e for e in candidate_evals
        if e["max_delta_e"] > 0 and e["hold_tier"] != "MUST_HOLD"
    ]
    any_positive_evals = [e for e in candidate_evals if e["max_delta_e"] > 0]
    best_eval = max(candidate_evals, key=lambda e: (e["max_delta_e"], -e["starts"], -e["z"])) if candidate_evals else None
    open_slot_result = evaluate_candidate_for_drop(None) if open_roster_spots > 0 else None

    if open_roster_spots > 0:
        system_suggested_action = {
            "type": "OPEN_SLOT",
            "target_player": None,
            "drop_starts": 0,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": (
                f"You have {open_roster_spots} open roster spot{'s' if open_roster_spots != 1 else ''} "
                f"({len(t1_players)}/{standard_capacity} active/bench filled) — pick up a Free Agent directly without dropping or benching anyone."
            ),
        }
        system_suggested_target_name = None
        system_hold_recommended = False
        auto_eval = None
    elif ir_move_evals:
        auto_eval = max(ir_move_evals, key=lambda e: (e["max_delta_e"], -e["starts"], -e["z"]))
        system_suggested_action = _build_action_for_eval(auto_eval, window_label, open_roster_spots, open_il_slots, fa_benchmark_z)
        system_suggested_target_name = auto_eval["player"].get("name")
        system_hold_recommended = False
    elif safe_positive_evals:
        auto_eval = max(
            safe_positive_evals,
            key=lambda e: (
                e["max_delta_e"] - (0.04 if e["hold_tier"] == "CORE_HOLD" else 0.0),
                -e["starts"],
                -e["z"],
            ),
        )
        system_suggested_action = _build_action_for_eval(auto_eval, window_label, open_roster_spots, open_il_slots, fa_benchmark_z)
        system_suggested_target_name = auto_eval["player"].get("name")
        system_hold_recommended = False
    elif any_positive_evals:
        auto_eval = max(any_positive_evals, key=lambda e: (e["max_delta_e"], -e["starts"], -e["z"]))
        system_suggested_action = {
            "type": "HOLD",
            "target_player": None,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": (
                "Hold recommended: Positive short-term streams would require dropping a core ROS player "
                f"(e.g. {auto_eval['player'].get('name')}). Click any roster card above if you want to stream anyway."
            ),
        }
        system_suggested_target_name = None
        system_hold_recommended = True
    else:
        auto_eval = best_eval
        system_suggested_action = {
            "type": "HOLD",
            "target_player": None,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": (
                "Hold recommended: Dropping any player on your roster for available waiver options "
                "results in a net expected category loss (all available streamers have ΔE ≤ 0)."
            ),
        }
        system_suggested_target_name = None
        system_hold_recommended = True

    per_target_limit = max(int(limit or 15), 15)
    recommendations_by_target = {}

    if open_slot_result is not None:
        os_recs, _, _ = open_slot_result
        os_action = {
            "type": "OPEN_SLOT",
            "target_player": None,
            "drop_starts": 0,
            "open_roster_spots": open_roster_spots,
            "open_il_slots": open_il_slots,
            "fa_benchmark_z": round(fa_benchmark_z, 2),
            "reason": (
                f"Open Roster / IR Spot mode — evaluating Free Agents for "
                f"{'today only' if pickup_mode == 'today' else 'the rest of the week'} with no player dropped or benched."
            ),
        }
        os_final, os_has_pos = _finalize_rec_list(os_recs, os_action, None, per_target_limit)
        recommendations_by_target["__OPEN_SLOT__"] = {
            "roster_action": os_action,
            "drop_player": None,
            "has_beneficial_streamers": os_has_pos,
            "hold_recommended": not os_has_pos,
            "hold_reason": None if os_has_pos else "No free agents with positive category impact left in this window.",
            "recommendations": os_final,
        }

    for ev in candidate_evals:
        p_name = ev["player"].get("name")
        c_action = _build_action_for_eval(ev, window_label, open_roster_spots, open_il_slots, fa_benchmark_z)
        c_final, c_has_pos = _finalize_rec_list(ev["recs"], c_action, ev["details"], per_target_limit)
        c_hold = not c_has_pos
        recommendations_by_target[p_name] = {
            "roster_action": c_action,
            "drop_player": ev["details"],
            "has_beneficial_streamers": c_has_pos,
            "hold_recommended": c_hold,
            "hold_reason": (
                f"Hold recommended: Replacing {p_name} with any available waiver option results in a net expected category loss (ΔE ≤ 0)."
                if c_hold else None
            ),
            "recommendations": c_final,
        }

    req_target = str(target_drop_player or "").strip()
    if req_target in ("__OPEN_SLOT__", "NONE") and open_roster_spots > 0 and "__OPEN_SLOT__" in recommendations_by_target:
        selected_bundle = recommendations_by_target["__OPEN_SLOT__"]
        hold_recommended = selected_bundle["hold_recommended"]
        hold_reason = selected_bundle["hold_reason"]
        roster_action = selected_bundle["roster_action"]
        drop_player_details = None
        has_beneficial = selected_bundle["has_beneficial_streamers"]
        final_recs = selected_bundle["recommendations"][:per_target_limit]
    elif req_target and req_target not in ("__AUTO__", "__HOLD__") and req_target in recommendations_by_target:
        selected_bundle = recommendations_by_target[req_target]
        hold_recommended = selected_bundle["hold_recommended"]
        hold_reason = selected_bundle["hold_reason"]
        roster_action = selected_bundle["roster_action"]
        drop_player_details = selected_bundle["drop_player"]
        has_beneficial = selected_bundle["has_beneficial_streamers"]
        final_recs = selected_bundle["recommendations"][:per_target_limit]
    else:
        if open_roster_spots > 0 and "__OPEN_SLOT__" in recommendations_by_target:
            raw_r, _, drop_player_details = open_slot_result
        elif auto_eval is not None:
            raw_r = auto_eval["recs"]
            drop_player_details = auto_eval["details"]
        else:
            raw_r = []
            drop_player_details = None
        roster_action = system_suggested_action
        final_recs, has_beneficial = _finalize_rec_list(raw_r, roster_action, drop_player_details, per_target_limit)
        hold_recommended = system_hold_recommended or not has_beneficial
        if hold_recommended:
            hold_reason = system_suggested_action["reason"] if system_hold_recommended else (
                f"Hold recommended: Replacing {drop_player_details.get('name') if drop_player_details else 'your current option'} "
                "results in a net expected category loss (ΔE ≤ 0)."
            )
        else:
            hold_reason = None

    roster_candidates = []
    for ev in candidate_evals:
        p = ev["player"]
        p_name = p.get("name")
        s_week = get_player_starts(p_name, week_date_strings)
        s_today = get_player_starts(p_name, [today_str])
        s_win = s_today if pickup_mode == "today" else s_week
        p_max_de = cand_max_de_map.get(p_name, -999.0)
        roster_candidates.append({
            "name": p_name,
            "nba_team": p.get("nba_team"),
            "positions": p.get("positions"),
            "selected_position": p.get("selected_position"),
            "status": p.get("status") or None,
            "is_tagged": ev["status"] in OUT_TAGS or ev["status"] in Q_TAGS,
            "z_total": round(ev["z"], 2),
            "ros_rank": ev["ros_rank"],
            "ros_z": round(float(ev["ros_z"]), 2) if ev.get("ros_z") is not None else None,
            "hold_tier": ev["hold_tier"],
            "starts_week": s_week,
            "starts_today": s_today,
            "starts_in_window": s_win,
            "max_delta_e": round(float(p_max_de), 3) if p_max_de != -999.0 else None,
            "is_suggested": bool(system_suggested_target_name and p_name == system_suggested_target_name),
        })

    roster_candidates.sort(
        key=lambda c: (
            0 if (c.get("max_delta_e") is not None and c["max_delta_e"] > 0 and c.get("hold_tier") != "MUST_HOLD")
            else (1 if (c.get("max_delta_e") is not None and c["max_delta_e"] > 0) else 2),
            -(c["max_delta_e"] if c.get("max_delta_e") is not None else -999.0),
            c["starts_in_window"],
            c["z_total"],
        )
    )

    return {
        "pickup_mode": pickup_mode,
        "punted_cats": sorted(punted_set),
        "has_beneficial_streamers": has_beneficial,
        "hold_recommended": hold_recommended,
        "hold_reason": hold_reason,
        "matchup_diagnostics": {
            "current_score": (
                baseline.get("accumulated_stats", {}).get("live_score")
                or baseline.get("accumulated_stats", {}).get("current_score", {})
            ),
            "categories": category_diagnostics,
        },
        "suggested_action": system_suggested_action,
        "roster_action": roster_action,
        "drop_player": drop_player_details if not (hold_recommended and (not req_target or req_target in ("__AUTO__", "__HOLD__"))) else None,
        "roster_candidates": roster_candidates,
        "open_roster_spots": open_roster_spots,
        "open_il_slots": open_il_slots,
        "recommendations": final_recs,
        "recommendations_by_target": recommendations_by_target,
    }
