import datetime
import os
import re
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
from backend.analysis import matchup_analysis_monte_carlo, matchup_analysis as run_matchup_analysis_calc

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
    roster_positions: list
    stats_source: str
    monte_carlo: bool = False

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

    yahoo_query = YahooFantasySportsQuery(
        league_id=league_id,
        game_code="nba",
        offline=False,
        yahoo_consumer_key=os.getenv("YAHOO_CONSUMER_KEY"),
        yahoo_consumer_secret=os.getenv("YAHOO_CONSUMER_SECRET"),
        env_file_location= Path("/app/auth"),
        save_token_data_to_env_file=False
    )

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

    yahoo_query = YahooFantasySportsQuery(
        league_id=league_id,
        game_code="nba",
        offline=False,
        yahoo_consumer_key=os.getenv("YAHOO_CONSUMER_KEY"),
        yahoo_consumer_secret=os.getenv("YAHOO_CONSUMER_SECRET"),
        env_file_location= Path("/app/auth"),
        save_token_data_to_env_file=False
    )

    if monte_carlo:
        results = matchup_analysis_monte_carlo(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule)
    else:
        results = run_matchup_analysis_calc(yahoo_query, team1, team2, week_num, date_start, roster_positions, stats_source, nba_schedule)

    return {
        "status": "success",
        "message": "Matchup analysis complete!",
        "payload": results
    }
