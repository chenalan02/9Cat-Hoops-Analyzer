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
            cursor.execute("SELECT * FROM nba_fantasy.gold.ema")
            arrow_table = cursor.fetchall_arrow()
            df = arrow_table.to_pandas()
            app.state.player_stats_ema = df.set_index('PLAYER_NAME').to_dict(orient='index')
            
            cursor.execute("SELECT * FROM nba_fantasy.gold.nba_games_schedule")
            arrow_table = cursor.fetchall_arrow()
            app.state.nba_schedule = arrow_table.to_pandas()

    print(f"[{datetime.datetime.now()}] Databricks data fetched and stored in app state.")

    # app.state is a persistent object linked to the app

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run on starup
    fetch_and_store_databricks(app)
    
    # run daily
    eastern = pytz.timezone('America/Toronto')
    scheduler = BackgroundScheduler(timezone=eastern)
    scheduler.add_job(
        fetch_and_store_databricks, 
        'cron', 
        hour=3, 
        minute=0, 
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


@app.get("/")
def home():
    return {"message": "Basketball API is running. Go to /docs"}



@app.post("/analyze-team")
async def analyze_team_link(request: TeamRequest):
    
    received_link = request.fantasy_link
    print(f"DEBUG: Received link to scrape: {received_link}")

    link_split = received_link.split("/")
    league_id = link_split[-2]
    team_id = link_split[-1]

    auth_path = Path("/app/auth")

    yahoo_query = YahooFantasySportsQuery(
        league_id=league_id,
        game_code="nba",
        offline=False,
        yahoo_consumer_key=os.getenv("YAHOO_CONSUMER_KEY"),
        yahoo_consumer_secret=os.getenv("YAHOO_CONSUMER_SECRET"),
        env_file_location= auth_path,
        save_token_data_to_env_file=False
    )

    league = FantasyLeague(yahoo_query, app.state.player_stats_ema)
    return {
        "status": "success",
        "message": "Link received!",
        "payload": league.to_dict() # Placeholder for actual player stats later
    }