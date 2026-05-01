import os
import pandas as pd
from datetime import datetime
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
    
def get_previous_season(season):
    start_year = int(season.split('-')[0])
    previous_start_year = start_year - 1
    previous_end_year = start_year
    return f"{previous_start_year}-{str(previous_end_year)[-2:]}"

def get_prev_n_seasons(current_season, n):
    seasons = []
    start_year = int(current_season.split('-')[0])
    for i in range(n):
        previous_start_year = start_year - (i + 1)
        previous_end_year = start_year - i
        seasons.append(f"{previous_start_year}-{str(previous_end_year)[-2:]}")
    return seasons

if __name__ == "__main__":

    load_dotenv()

    w = WorkspaceClient(
        host=os.getenv("DATABRICKS_URL"),
        token=os.getenv("ETL_TOKEN")
    )

    current_season = get_current_season()
    for season in [current_season] + get_prev_n_seasons(current_season, 5):

        extract_json = leaguegamelog.LeagueGameLog(
            player_or_team_abbreviation='P', # 'P' for Player stats
            season=season,
            season_type_all_star='Regular Season'
        ).get_normalized_json()

        df = pd.DataFrame([{
            "extraction_timestamp": datetime.now().isoformat(),
            "raw_json": extract_json
        }])

        temp_file = f"backfill_nba_logs_{season}.parquet"
        df.to_parquet(temp_file, index=False)

        with open(temp_file, "rb") as f:
            remote_path = os.path.join(os.getenv("BRONZE_GAME_LOG_URL"), os.path.basename(temp_file))
            w.files.upload(remote_path, f, overwrite=True)

        os.remove(temp_file)