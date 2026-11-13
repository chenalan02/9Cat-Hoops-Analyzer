import datetime
import os
import re
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import pandas as pd
import pytz
from apscheduler.schedulers.background import BackgroundScheduler
from databricks import sql
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scipy.stats import norm
from yfpy.query import YahooFantasySportsQuery

from backend.models import *
from backend.analysis import (
    matchup_analysis_monte_carlo,
    matchup_analysis as run_matchup_analysis_calc,
    get_streamer_recommendations,
    get_top_free_agents,
    get_draft_pool,
)

load_dotenv()

# fetch data from Databricks and store it in the app's state once a day and at startup
def fetch_and_store_databricks(app: FastAPI):
    print(f"[{datetime.datetime.now()}] Fetching from Databricks...")
    
    with sql.connect(
    server_hostname=os.getenv("DATABRICKS_URL"),
    http_path=os.getenv("SQL_WAREHOUSE_HTTP_PATH"),
    access_token=os.getenv("BACKEND_TOKEN")
    ) as connection:
        with connection.cursor() as cursor:
            
            # fetch and cache NBA Schedule
            cursor.execute("SELECT * FROM nba_fantasy.gold.nba_games_schedule")
            arrow_table = cursor.fetchall_arrow()
            app.state.nba_schedule = arrow_table.to_pandas()

            app.state.player_stats = {}
            # fetch and cache player stats/rankings
            for table in ["ema", "ros_rankings", "weekly_rankings", "preseason_rankings"]:
                cursor.execute(f"SELECT * FROM nba_fantasy.gold.{table}")
                arrow_table = cursor.fetchall_arrow()
                df = arrow_table.to_pandas()
                app.state.player_stats[table] = (
                    df.replace({np.nan: None})
                      .set_index('PLAYER_NAME')
                      .to_dict(orient='index')
                )

    print(f"[{datetime.datetime.now()}] Databricks data fetched and stored in app state.")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run on startup
    fetch_and_store_databricks(app)
    
    # run daily
    eastern = pytz.timezone('America/Toronto')
    scheduler = BackgroundScheduler(timezone=eastern)
    scheduler.add_job(
        fetch_and_store_databricks, 
        'cron', 
        hour=3, 
        minute=30, 
        args=[app]
    )

    scheduler.start()
    
    yield
    
    scheduler.shutdown()


app = FastAPI(lifespan=lifespan)


# Allow the local frontend to talk to this local backend
origins = [
    "http://127.0.0.1:5500",   # VS Code Live Server (legacy)
    "http://localhost:5500",
    "http://localhost:5173",    # Vite dev server
    "http://127.0.0.1:5173",
    "http://localhost:3000",    # Create React App / other dev servers
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], # Allow GET, POST, DELETE, etc.
    allow_headers=["*"],
)

# Define what the incoming data looks like
class TeamRequest(BaseModel):
    fantasy_link: str

class MatchupRequest(BaseModel):
    league_id: str
    team1: dict
    team2: dict
    week_num: int
    date_start: str
    roster_positions: list | None = None
    stats_source: str
    monte_carlo: bool = False

class StreamerRequest(BaseModel):
    league_id: str
    team1: dict
    team2: dict
    week_num: int
    date_start: str
    roster_positions: list | None = None
    stats_source: str = "ema"
    all_rostered_names: list = []
    limit: int = 6
    target_drop_player: str | None = None
    pickup_mode: str = "week"
    punted_cats: list[str] = []


class FreeAgentsRequest(BaseModel):
    league_id: str
    stats_source: str = "ros_stats"
    all_rostered_names: list = []
    limit: int = 45

_QUERY_LOCK = threading.Lock()
_QUERY_CACHE = {}

def get_yahoo_query(league_id: str) -> YahooFantasySportsQuery:
    '''
    Retrieves or creates a YahooFantasySportsQuery instance for the given league_id.
    Reusing existing instances preserves keep-alive HTTPS connections and cached
    league/game metadata, drastically cutting down TLS handshakes and token validations.
    '''
    lid = str(league_id).strip()
    with _QUERY_LOCK:
        q = _QUERY_CACHE.get(lid)
        if q is not None:
            try:
                if q.oauth.token_is_valid():
                    return q
            except Exception:
                pass

        q = YahooFantasySportsQuery(
            league_id=lid,
            game_code="nba",
            offline=False,
            yahoo_consumer_key=os.getenv("YAHOO_CONSUMER_KEY"),
            yahoo_consumer_secret=os.getenv("YAHOO_CONSUMER_SECRET"),
            env_file_location=Path("/app/auth"),
            save_token_data_to_env_file=False
        )
        _QUERY_CACHE[lid] = q
        return q


@app.get("/")
def home():
    return {"message": "Basketball API is running. Go to /docs"}

@app.post("/analyze-team")
def analyze_team_link(request: TeamRequest):
    received_link = request.fantasy_link
    print(f"DEBUG: Received link to scrape: {received_link}")

    link_split = received_link.split("/")
    league_id = link_split[-2]
    team_id = link_split[-1]

    yahoo_query = get_yahoo_query(league_id)
    league = FantasyLeague(yahoo_query, app.state.player_stats)
    return {
        "status": "success",
        "message": "Link received!",
        "payload": league.to_dict()
    }

@app.post("/matchup-analysis")
def matchup_analysis_endpoint(request: MatchupRequest):
    league_id = request.league_id
    team1 = request.team1
    team2 = request.team2
    week_num = request.week_num
    date_start = request.date_start
    roster_positions = request.roster_positions
    stats_source = request.stats_source
    monte_carlo = request.monte_carlo
    nba_schedule = app.state.nba_schedule

    yahoo_query = get_yahoo_query(league_id)

    if monte_carlo:
        results = matchup_analysis_monte_carlo(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule)
    else:
        results = run_matchup_analysis_calc(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule)

    return {
        "status": "success",
        "message": "Matchup analysis complete!",
        "payload": results
    }

@app.post("/streamer-recommendations")
def streamer_recommendations_endpoint(request: StreamerRequest):
    league_id = request.league_id
    team1 = request.team1
    team2 = request.team2
    week_num = request.week_num
    date_start = request.date_start
    roster_positions = request.roster_positions
    stats_source = request.stats_source
    all_rostered_names = request.all_rostered_names or None
    limit = request.limit
    nba_schedule = getattr(app.state, "nba_schedule", None)

    try:
        yahoo_query = get_yahoo_query(league_id)

        # Map frontend stats_source aliases to Databricks table keys
        pool_key_map = {
            "weekly_stats": "weekly_rankings",
            "ros_stats": "ros_rankings",
        }
        pool_key = pool_key_map.get(stats_source, stats_source)

        primary_pool = (
            app.state.player_stats.get(pool_key, {})
            if hasattr(app.state, "player_stats") and app.state.player_stats
            else {}
        )
        ema_pool = (
            app.state.player_stats.get("ema", {})
            if hasattr(app.state, "player_stats") and app.state.player_stats
            else {}
        )

        # Merge so weekly projections take precedence, falling back to EMA for unranked waiver wire players
        if pool_key == "weekly_rankings" and primary_pool:
            tagged_ema = {
                k: {**v, "is_ema_fallback": True}
                for k, v in ema_pool.items()
                if k not in primary_pool
            }
            player_stats_pool = {**tagged_ema, **primary_pool}
        else:
            player_stats_pool = {**ema_pool, **primary_pool}

        ros_stats_pool = (
            app.state.player_stats.get("ros_rankings", {})
            if hasattr(app.state, "player_stats") and app.state.player_stats
            else {}
        )

        results = get_streamer_recommendations(
            yahoo_query=yahoo_query,
            team1=team1,
            team2=team2,
            week_num=week_num,
            date_start=date_start,
            roster_positions=roster_positions,
            stats_source=stats_source,
            nba_schedule=nba_schedule,
            player_stats_pool=player_stats_pool,
            all_rostered_names=all_rostered_names,
            limit=limit,
            target_drop_player=request.target_drop_player,
            pickup_mode=request.pickup_mode,
            punted_cats=request.punted_cats,
            ros_stats_pool=ros_stats_pool,
        )

        return {
            "status": "success",
            "message": "Streamer recommendations complete!",
            "payload": results
        }
    except Exception as e:
        print(f"Error in streamer recommendations: {e}")
        return {
            "status": "error",
            "message": str(e),
            "payload": None
        }


@app.post("/free-agents")
def free_agents_endpoint(request: FreeAgentsRequest):
    league_id = request.league_id
    stats_source = request.stats_source
    all_rostered_names = request.all_rostered_names or None
    limit = max(1, min(int(request.limit or 45), 100))

    try:
        yahoo_query = get_yahoo_query(league_id)
        pool_key_map = {
            "weekly_stats": "weekly_rankings",
            "ros_stats": "ros_rankings",
            "preseason_stats": "preseason_rankings",
        }
        pool_key = pool_key_map.get(stats_source, stats_source)
        stats_by_source = app.state.player_stats if hasattr(app.state, "player_stats") and app.state.player_stats else {}

        free_agents = get_top_free_agents(
            yahoo_query=yahoo_query,
            player_stats_by_source=stats_by_source,
            all_rostered_names=all_rostered_names,
            stats_source=pool_key,
            limit=limit,
        )
        return {
            "status": "success",
            "message": f"Loaded {len(free_agents)} top free agents.",
            "payload": free_agents,
        }
    except Exception as e:
        print(f"Error fetching free agents: {e}")
        return {
            "status": "error",
            "message": str(e),
            "payload": [],
        }


@app.get("/draft-pool")
def draft_pool_endpoint(limit: int = 350):
    capped_limit = max(1, min(int(limit or 350), 600))
    try:
        stats_by_source = (
            app.state.player_stats
            if hasattr(app.state, "player_stats") and app.state.player_stats
            else {}
        )
        payload = get_draft_pool(stats_by_source, limit=capped_limit)
        return {
            "status": "success",
            "message": f"Loaded {len(payload.get('players', []))} players for draft pool.",
            "payload": payload,
        }
    except Exception as e:
        print(f"Error loading draft pool: {e}")
        return {
            "status": "error",
            "message": str(e),
            "payload": {"players": [], "sources_available": [], "default_source": "preseason", "total_in_db": 0},
        }

