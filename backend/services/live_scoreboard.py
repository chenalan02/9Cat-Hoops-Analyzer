import datetime
import threading
import time
from typing import Any

import pytz
import requests

from backend.core.logging import logger
from backend.services.stats_utils import normalize_nba_team, parse_iso_date

_ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
_CACHE_TTL_SECS = 60.0
_ERROR_BACKOFF_SECS = 30.0
_MAX_CACHE_ENTRIES = 16
_REQUEST_TIMEOUT = (2.0, 3.0)
_ET_TZ = pytz.timezone("America/New_York")

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "9Cat-Hoops-Analyzer/1.0"})

_CACHE_LOCK = threading.Lock()
_SCOREBOARD_CACHE: dict[str, tuple[float, float, dict[str, dict[str, Any]]]] = {}


def clear_scoreboard_cache() -> None:
    """Clear the in-memory ESPN scoreboard cache (primarily for tests)."""
    with _CACHE_LOCK:
        _SCOREBOARD_CACHE.clear()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if parsed == parsed else default
    except (ValueError, TypeError):
        return default


def compute_remaining_fraction(status_obj: dict[str, Any] | None) -> tuple[str, float, str, str]:
    """Return (state, remaining_fraction, status_name, detail) from an ESPN status object."""
    status = status_obj if isinstance(status_obj, dict) else {}
    st_type = status.get("type") if isinstance(status.get("type"), dict) else {}

    state = str(st_type.get("state") or "").lower().strip()
    status_name = str(st_type.get("name") or "").upper().strip()
    completed = bool(st_type.get("completed"))
    detail = str(st_type.get("shortDetail") or st_type.get("detail") or "").strip()

    if status_name in ("STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_CANCELLED"):
        return ("post", 0.0, status_name, detail or "Postponed")

    if state == "post" or completed:
        return ("post", 0.0, status_name or "STATUS_FINAL", detail or "Final")

    if state == "pre":
        return ("pre", 1.0, status_name or "STATUS_SCHEDULED", detail)

    if state == "in":
        period = _safe_int(status.get("period"), 0)
        clock = _safe_float(status.get("clock"), 0.0)
        if period <= 0:
            rem_frac = 1.0
        elif period <= 4:
            clock_secs = max(0.0, min(720.0, clock))
            rem_secs = max(0.0, (4 - period) * 720.0 + clock_secs)
            rem_frac = max(0.0, min(1.0, rem_secs / 2880.0))
        else:
            clock_secs = max(0.0, min(300.0, clock))
            rem_frac = max(0.0, min(300.0 / 2880.0, clock_secs / 2880.0))
        return ("in", round(rem_frac, 4), status_name or "STATUS_IN_PROGRESS", detail)

    return ("pre", 1.0, status_name, detail)


def parse_espn_scoreboard(payload: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Parse an ESPN scoreboard payload into {TEAM_NORM: game_status_info}."""
    if not isinstance(payload, dict):
        return {}

    teams_map: dict[str, dict[str, Any]] = {}
    for ev in payload.get("events") or []:
        if not isinstance(ev, dict):
            continue
        event_id = str(ev.get("id") or "").strip()
        competitions = ev.get("competitions") or []
        comp = competitions[0] if isinstance(competitions, list) and competitions else {}
        if not isinstance(comp, dict):
            comp = {}

        status_obj = comp.get("status") or ev.get("status") or {}
        state, rem_frac, status_name, detail = compute_remaining_fraction(status_obj)
        period = _safe_int(status_obj.get("period"), 0) if isinstance(status_obj, dict) else 0
        clock = _safe_float(status_obj.get("clock"), 0.0) if isinstance(status_obj, dict) else 0.0

        for competitor in comp.get("competitors") or []:
            if not isinstance(competitor, dict):
                continue
            team_info = competitor.get("team") or {}
            raw_abbr = team_info.get("abbreviation") if isinstance(team_info, dict) else None
            team_norm = normalize_nba_team(raw_abbr)
            if not team_norm:
                continue
            teams_map[team_norm] = {
                "event_id": event_id,
                "state": state,
                "status_name": status_name,
                "detail": detail,
                "period": period,
                "clock": clock,
                "remaining_fraction": rem_frac,
            }

    return teams_map


def _store_cache_entry(date_str: str, ttl: float, data: dict[str, dict[str, Any]]) -> None:
    now = time.time()
    with _CACHE_LOCK:
        if date_str not in _SCOREBOARD_CACHE and len(_SCOREBOARD_CACHE) >= _MAX_CACHE_ENTRIES:
            oldest_key = min(_SCOREBOARD_CACHE, key=lambda k: _SCOREBOARD_CACHE[k][0])
            _SCOREBOARD_CACHE.pop(oldest_key, None)
        _SCOREBOARD_CACHE[date_str] = (now, ttl, {k: dict(v) for k, v in data.items()})


def fetch_espn_scoreboard_for_date(target_date: datetime.date) -> dict[str, dict[str, Any]]:
    """Fetch and cache the ESPN NBA scoreboard for a single calendar date (ET)."""
    date_str = target_date.isoformat()
    now = time.time()
    with _CACHE_LOCK:
        cached = _SCOREBOARD_CACHE.get(date_str)
        if cached is not None:
            ts, ttl, data = cached
            if (now - ts) < ttl:
                return {k: dict(v) for k, v in data.items()}

    try:
        resp = _SESSION.get(
            _ESPN_SCOREBOARD_URL,
            params={"dates": target_date.strftime("%Y%m%d")},
            timeout=_REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        parsed = parse_espn_scoreboard(resp.json())
        _store_cache_entry(date_str, _CACHE_TTL_SECS, parsed)
        return {k: dict(v) for k, v in parsed.items()}
    except Exception as exc:
        logger.warning("Failed fetching ESPN NBA scoreboard for %s: %s", date_str, exc)
        _store_cache_entry(date_str, _ERROR_BACKOFF_SECS, {})
        return {}


def get_live_game_progress(
    date_start: Any,
    now_et: datetime.datetime | None = None,
) -> dict[str, dict[str, dict[str, Any]]]:
    """Return live NBA game progress keyed by ISO date string and normalized NBA team abbr."""
    date_start_dt = parse_iso_date(date_start)
    current_et = now_et or datetime.datetime.now(_ET_TZ)
    today_et = current_et.date()

    # Skip network calls when the user overrides date_start to a distant historical/future date.
    if abs((date_start_dt - today_et).days) > 1:
        return {}

    result: dict[str, dict[str, dict[str, Any]]] = {}
    today_data = fetch_espn_scoreboard_for_date(date_start_dt)
    if today_data:
        result[date_start_dt.isoformat()] = today_data

    # Past-midnight ET: include late West Coast games from yesterday only if still in progress
    # and still within the current Mon-Sun fantasy scoring week.
    if date_start_dt == today_et and current_et.hour < 5:
        prev_day = date_start_dt - datetime.timedelta(days=1)
        week_monday = date_start_dt - datetime.timedelta(days=date_start_dt.weekday())
        if prev_day >= week_monday:
            prev_data = fetch_espn_scoreboard_for_date(prev_day)
            if any(
                info.get("state") == "in" and float(info.get("remaining_fraction") or 0.0) > 0.0
                for info in prev_data.values()
            ):
                result[prev_day.isoformat()] = prev_data

    return result


def summarize_live_progress(
    live_progress_by_date: dict[str, dict[str, dict[str, Any]]] | None,
    date_start: str,
) -> dict[str, Any]:
    """Summarize unique in-progress, final, and scheduled games for UI metadata."""
    if not live_progress_by_date:
        return {
            "active": False,
            "in_progress_games": 0,
            "final_games_today": 0,
            "scheduled_games_today": 0,
        }

    in_progress_ids: set[str] = set()
    in_progress_unkeyed = 0
    for day_map in live_progress_by_date.values():
        if not isinstance(day_map, dict):
            continue
        for info in day_map.values():
            if not isinstance(info, dict) or info.get("state") != "in":
                continue
            eid = str(info.get("event_id") or "").strip()
            if eid:
                in_progress_ids.add(eid)
            else:
                in_progress_unkeyed += 1

    final_ids: set[str] = set()
    final_unkeyed = 0
    sched_ids: set[str] = set()
    sched_unkeyed = 0
    today_map = live_progress_by_date.get(date_start) or {}
    if isinstance(today_map, dict):
        for info in today_map.values():
            if not isinstance(info, dict):
                continue
            state = info.get("state")
            eid = str(info.get("event_id") or "").strip()
            if state == "post":
                if eid:
                    final_ids.add(eid)
                else:
                    final_unkeyed += 1
            elif state == "pre":
                if eid:
                    sched_ids.add(eid)
                else:
                    sched_unkeyed += 1

    in_progress_games = len(in_progress_ids) + ((in_progress_unkeyed + 1) // 2)
    final_games_today = len(final_ids) + ((final_unkeyed + 1) // 2)
    scheduled_games_today = len(sched_ids) + ((sched_unkeyed + 1) // 2)

    return {
        "active": bool(in_progress_games > 0 or final_games_today > 0),
        "in_progress_games": in_progress_games,
        "final_games_today": final_games_today,
        "scheduled_games_today": scheduled_games_today,
    }
