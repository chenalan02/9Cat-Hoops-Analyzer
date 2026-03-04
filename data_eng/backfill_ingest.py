import os
import pandas as pd
from datetime import datetime
from nba_api.stats.endpoints import leaguegamelog
from databricks.sdk import WorkspaceClient
from dotenv import load_dotenv

load_dotenv()

def get_current_season():
    current_date = datetime.now()
    current_year = current_date.year
    current_month = current_date.month

    if current_month > 4:
        return f"{current_year}-{str(current_year + 1)[-2:]}"
    else:
        return f"{current_year - 1}-{str(current_year)[-2:]}"
    
def get_previous_season(season):
    start_year = int(season.split('-')[0])
    previous_start_year = start_year - 1
    previous_end_year = start_year
    return f"{previous_start_year}-{str(previous_end_year)[-2:]}"

if __name__ == "__main__":

    w = WorkspaceClient(
        host=os.getenv("DATABRICKS_URL"),
        token=os.getenv("ETL_TOKEN")
    )

    for season in [get_current_season(), get_previous_season(get_current_season())]:

        extract_json = leaguegamelog.LeagueGameLog(
            player_or_team_abbreviation='P', # 'P' for Player stats
            season=season,
            season_type_all_star='Regular Season'
        ).get_json()

        df = pd.DataFrame([{
            "extraction_timestamp": datetime.now().isoformat(),
            "raw_json": extract_json
        }])

        temp_file = f"backfill_nba_logs_{season}.parquet"
        df.to_parquet(temp_file, index=False)

        with open(temp_file, "rb") as f:
            w.files.upload(os.path.join(os.getenv("BRONZE_GAME_LOG_URL"), temp_file), f, overwrite=True)

        os.remove(temp_file)