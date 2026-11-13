from backend.services import yahoo_client
from backend.services.stats_utils import OUT_TAGS, extract_rank_and_z, normalize_nba_team
from backend.utils import clean_player_name


def get_top_free_agents(
    yahoo_query,
    player_stats_by_source,
    all_rostered_names=None,
    stats_source="ros_rankings",
    limit=20,
):
    rostered_set = set(all_rostered_names or [])
    rostered_clean = {clean_player_name(name).lower() for name in rostered_set if name}

    fa_info_map = yahoo_client.get_yahoo_fa_info_map(yahoo_query) if yahoo_query else {}
    resolve_pos = yahoo_client.build_position_resolver(
        yahoo_query=yahoo_query,
        fa_info_map=fa_info_map,
        teams=None,
    )

    stats_by_source = player_stats_by_source or {}
    pool_map = {
        "ros": stats_by_source.get("ros_rankings", {}) or {},
        "ros_rankings": stats_by_source.get("ros_rankings", {}) or {},
        "ema": stats_by_source.get("ema", {}) or {},
        "weekly": stats_by_source.get("weekly_rankings", {}) or {},
        "weekly_rankings": stats_by_source.get("weekly_rankings", {}) or {},
        "weekly_stats": stats_by_source.get("weekly_rankings", {}) or {},
    }
    primary = pool_map.get(stats_source) or pool_map["ros"] or pool_map["ema"]

    candidates = []
    for p_name, p_stats in primary.items():
        clean_n = clean_player_name(p_name)
        if p_name in rostered_set or clean_n.lower() in rostered_clean:
            continue
        if (p_stats.get("games_played") or 0) < 3:
            continue
        if (p_stats.get("mu_min") or 0) < 13.0:
            continue

        fa_entry = (
            fa_info_map.get(clean_n)
            or fa_info_map.get(p_name)
            or fa_info_map.get(clean_n.lower())
            or fa_info_map.get(p_name.lower())
            or {}
        )
        y_status = str(fa_entry.get("status", "") if isinstance(fa_entry, dict) else "").upper().strip()
        db_status = str(p_stats.get("status") or p_stats.get("injury_status") or "").upper().strip()
        if y_status in OUT_TAGS or db_status in OUT_TAGS:
            continue

        z_val = p_stats.get("z_total")
        z_num = float(z_val) if z_val is not None else -99.0
        candidates.append((z_num, p_name, clean_n, p_stats, y_status or db_status or None))

    candidates.sort(key=lambda item: item[0], reverse=True)
    out = []
    for z_num, p_name, clean_n, _, status in candidates[:limit]:
        ros_d = dict(pool_map["ros"].get(p_name) or pool_map["ros"].get(clean_n) or {})
        ema_d = dict(pool_map["ema"].get(p_name) or pool_map["ema"].get(clean_n) or {})
        wk_d = dict(pool_map["weekly"].get(p_name) or pool_map["weekly"].get(clean_n) or {})
        pos_str = resolve_pos(p_name, ros_d or ema_d, allow_yahoo_lookup=False)
        raw_team = (ros_d or ema_d or wk_d).get("team")
        rank_val, _ = extract_rank_and_z(ros_d or ema_d or wk_d)
        out.append({
            "name": clean_n or p_name,
            "nba_team": normalize_nba_team(raw_team),
            "positions": pos_str,
            "selected_position": "FA",
            "status": status,
            "rank": rank_val,
            "z_total": round(float(z_num), 4) if z_num > -99.0 else None,
            "ros_stats": ros_d,
            "ema_stats": ema_d,
            "weekly_stats": wk_d,
        })
    return out
