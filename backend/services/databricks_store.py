import datetime
import decimal
import gc
import math
from typing import Any

from databricks import sql

from backend.core.config import Settings
from backend.core.logging import logger
from backend.services.stats_utils import normalize_nba_team
from backend.utils import clean_player_name

STATS_TABLES = ("ema", "ros_rankings", "weekly_rankings", "preseason_rankings")

SOURCE_KEY_ALIASES = {
    "weekly_stats": "weekly_rankings",
    "ros_stats": "ros_rankings",
    "preseason_stats": "preseason_rankings",
}


def resolve_table_key(stats_source: str) -> str:
    return SOURCE_KEY_ALIASES.get(stats_source, stats_source)


def _normalize_db_value(value: Any) -> Any:
    if isinstance(value, float):
        return None if not math.isfinite(value) else value
    if isinstance(value, decimal.Decimal):
        float_val = float(value)
        return None if not math.isfinite(float_val) else float_val
    return value


def _fetch_schedule_rows(cursor: Any) -> list[dict[str, Any]]:
    cursor.execute("SELECT * FROM nba_fantasy.gold.nba_games_schedule")
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    return [
        {col: _normalize_db_value(val) for col, val in zip(columns, row)}
        for row in rows
    ]


def _fetch_player_table_dict(cursor: Any, table_name: str) -> dict[str, dict[str, Any]]:
    cursor.execute(f"SELECT * FROM nba_fantasy.gold.{table_name}")
    columns = [desc[0] for desc in cursor.description]
    name_idx = columns.index("PLAYER_NAME")
    rows = cursor.fetchall()

    table_dict: dict[str, dict[str, Any]] = {}
    for row in rows:
        player_name = row[name_idx]
        if player_name is None:
            continue
        table_dict[player_name] = {
            col: _normalize_db_value(val)
            for idx, (col, val) in enumerate(zip(columns, row))
            if idx != name_idx
        }
    return table_dict


def _parse_matchup(matchup_str: str | None) -> tuple[str, bool]:
    text = str(matchup_str or "").strip()
    if " vs. " in text:
        return normalize_nba_team(text.split(" vs. ", 1)[1]), True
    if " vs " in text:
        return normalize_nba_team(text.split(" vs ", 1)[1]), True
    if " @ " in text:
        return normalize_nba_team(text.split(" @ ", 1)[1]), False
    return "", True


def _int_stat(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _fetch_game_logs(cursor: Any) -> dict[str, list[dict[str, Any]]]:
    cursor.execute(
        """
        SELECT
            PLAYER_NAME, GAME_ID, GAME_DATE, SEASON_ID, TEAM_ABBREVIATION,
            MATCHUP, WL, MIN, PTS, REB, OREB, DREB, AST, STL, BLK,
            FG3M, FG3A, FGM, FGA, FTM, FTA, TOV, PF, PLUS_MINUS
        FROM nba_fantasy.silver.nba_game_logs
        WHERE SEASON_ID = (
            SELECT COALESCE(
                MAX(CASE WHEN SEASON_ID LIKE '2%' THEN SEASON_ID END),
                MAX(SEASON_ID)
            )
            FROM nba_fantasy.silver.nba_game_logs
        )
        ORDER BY GAME_DATE DESC, GAME_ID DESC
        """
    )
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        record = dict(zip(columns, row))
        raw_name = record.get("PLAYER_NAME")
        if not raw_name:
            continue
        cleaned_name = clean_player_name(raw_name) or str(raw_name).strip()

        raw_date = record.get("GAME_DATE")
        game_date_str = raw_date.isoformat() if hasattr(raw_date, "isoformat") else (str(raw_date) if raw_date else "")
        matchup = str(record.get("MATCHUP") or "").strip()
        opponent, is_home = _parse_matchup(matchup)

        fgm = _int_stat(record.get("FGM"))
        fga = _int_stat(record.get("FGA"))
        ftm = _int_stat(record.get("FTM"))
        fta = _int_stat(record.get("FTA"))
        fg3m = _int_stat(record.get("FG3M"))
        fg3a = _int_stat(record.get("FG3A"))

        grouped.setdefault(cleaned_name, []).append(
            {
                "game_id": str(record.get("GAME_ID") or "").strip(),
                "game_date": game_date_str,
                "season_id": str(record.get("SEASON_ID") or "").strip(),
                "team": normalize_nba_team(record.get("TEAM_ABBREVIATION")),
                "matchup": matchup,
                "opponent": opponent,
                "is_home": is_home,
                "wl": str(record.get("WL") or "").strip().upper() or None,
                "min": _int_stat(record.get("MIN")),
                "pts": _int_stat(record.get("PTS")),
                "reb": _int_stat(record.get("REB")),
                "oreb": _int_stat(record.get("OREB")),
                "dreb": _int_stat(record.get("DREB")),
                "ast": _int_stat(record.get("AST")),
                "stl": _int_stat(record.get("STL")),
                "blk": _int_stat(record.get("BLK")),
                "fg3m": fg3m,
                "fg3a": fg3a,
                "fgm": fgm,
                "fga": fga,
                "ftm": ftm,
                "fta": fta,
                "tov": _int_stat(record.get("TOV")),
                "pf": _int_stat(record.get("PF")),
                "plus_minus": _optional_int(record.get("PLUS_MINUS")),
                "fg_pct": round(fgm / fga, 4) if fga > 0 else None,
                "ft_pct": round(ftm / fta, 4) if fta > 0 else None,
                "fg3_pct": round(fg3m / fg3a, 4) if fg3a > 0 else None,
            }
        )

    return grouped


def refresh_databricks_cache(app_state: Any, settings: Settings) -> None:
    logger.info("Refreshing Databricks projection tables, NBA schedule, and player game logs.")

    game_logs: dict[str, list[dict[str, Any]]] = {}
    with sql.connect(
        server_hostname=settings.databricks_url,
        http_path=settings.databricks_http_path,
        access_token=settings.databricks_token,
    ) as connection:
        with connection.cursor() as cursor:
            schedule_rows = _fetch_schedule_rows(cursor)
            player_stats: dict[str, dict[str, Any]] = {}
            for table in STATS_TABLES:
                player_stats[table] = _fetch_player_table_dict(cursor, table)
            try:
                game_logs = _fetch_game_logs(cursor)
            except Exception as exc:
                logger.warning("Failed fetching nba_fantasy.silver.nba_game_logs: %s", exc)
                game_logs = {}

    app_state.nba_schedule = schedule_rows
    app_state.player_stats = player_stats
    app_state.game_logs = game_logs
    app_state.last_refreshed = datetime.datetime.now(datetime.timezone.utc).isoformat()
    gc.collect()
    total_logs = sum(len(entries) for entries in game_logs.values())
    logger.info(
        "Databricks cache updated (%d schedule rows, %d game log rows across %d players).",
        len(schedule_rows),
        total_logs,
        len(game_logs),
    )


def resolve_streamer_stats_pools(
    player_stats: dict[str, dict[str, Any]] | None,
    stats_source: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    stats_map = player_stats or {}
    pool_key = resolve_table_key(stats_source)
    primary_pool = stats_map.get(pool_key, {}) or {}
    ema_pool = stats_map.get("ema", {}) or {}

    if pool_key == "weekly_rankings" and primary_pool:
        # Tag EMA entries so streamer filtering excludes unprojected fringe players from weekly matchups.
        tagged_ema = {
            name: {**row, "is_ema_fallback": True}
            for name, row in ema_pool.items()
            if name not in primary_pool
        }
        merged_pool = {**tagged_ema, **primary_pool}
    else:
        merged_pool = {**ema_pool, **primary_pool}

    ros_stats_pool = stats_map.get("ros_rankings", {}) or {}
    return merged_pool, ros_stats_pool
