import os
import pandas as pd
from datetime import datetime, timedelta
from nba_api.stats.endpoints import leaguegamelog
from databricks.sdk import WorkspaceClient
from dotenv import load_dotenv

def get_current_season():
    current_date = datetime.now()
    current_year = current_date.year
    current_month = current_date.month

    if current_month > 4:
        return f"{current_year}-{str(current_year + 1)[-2:]}"
    else:
        return f"{current_year - 1}-{str(current_year)[-2:]}"
    
if __name__ == "__main__":

    load_dotenv()

    w = WorkspaceClient(
    host=os.getenv("DATABRICKS_URL"),
    token=os.getenv("ETL_TOKEN")
    )

    current_season = get_current_season()
    dt = datetime.now()
    dt_from = dt - timedelta(days=1)

    custom_headers = {
    'Host': 'stats.nba.com',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,/;q=0.8,application/signed-exchange;v=b3',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    }

    extract_json = leaguegamelog.LeagueGameLog(
        player_or_team_abbreviation='P', # 'P' for Player stats
        season=current_season,
        season_type_all_star='Regular Season',
        date_from_nullable=dt_from.strftime("%m/%d/%Y"),
        date_to_nullable=None,
        headers=custom_headers
    ).get_json()

    df = pd.DataFrame([{
        "extraction_timestamp": dt.isoformat(),
        "raw_json": extract_json
    }])

    temp_file = f"nba_logs_{dt.strftime("%Y-%m-%d")}.parquet"
    df.to_parquet(temp_file, index=False)

    with open(temp_file, "rb") as f:
        w.files.upload(os.path.join(os.getenv("BRONZE_URL"), temp_file), f, overwrite=True)

    os.remove(temp_file)
