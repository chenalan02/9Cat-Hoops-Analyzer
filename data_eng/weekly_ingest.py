import os
import pandas as pd
import time
from datetime import datetime
from nba_api.stats.endpoints import scheduleleaguev2, leaguedashplayerbiostats
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

    schedule_json = scheduleleaguev2.ScheduleLeagueV2().get_json()

    df = pd.DataFrame([{
        "extraction_timestamp": datetime.now().isoformat(),
        "raw_json": schedule_json
    }])

    temp_file = f"/Users/alanchen/Documents/9Cat-Hoops-Analyzer/nba_schedule_{get_current_season()}_{datetime.now().strftime('%Y-%m-%d')}.parquet"
    df.to_parquet(temp_file, index=False)

    with open(temp_file, "rb") as f:
        remote_path = os.path.join(os.getenv("BRONZE_SCHEDULE_URL"), os.path.basename(temp_file))
        w.files.upload(remote_path, f, overwrite=True)

    os.remove(temp_file)

    # ingest bio data
    bio_ingest_df = pd.DataFrame()
    current_season = get_current_season()

    for season in [current_season] + get_prev_n_seasons(current_season, 5):

        bio_data = leaguedashplayerbiostats.LeagueDashPlayerBioStats(season=season)
        bio_df = bio_data.get_data_frames()[0][["PLAYER_ID", "PLAYER_NAME", "AGE", "PLAYER_HEIGHT_INCHES"]]
        bio_df["SEASON"] = season
        bio_ingest_df = pd.concat([bio_ingest_df, bio_df], ignore_index=True)
        time.sleep(0.5)  # Sleep for 1 second to avoid hitting rate limits

    bio_json = bio_ingest_df.to_json(orient='records', lines=True)

    df = pd.DataFrame([{
        "extraction_timestamp": datetime.now().isoformat(),
        "raw_json": bio_json
    }])

    temp_file = f"/Users/alanchen/Documents/9Cat-Hoops-Analyzer/nba_bio_{datetime.now().strftime('%Y-%m-%d')}.parquet"
    df.to_parquet(temp_file, index=False)

    with open(temp_file, "rb") as f:
        remote_path = os.path.join(os.getenv("BRONZE_BIO_URL"), os.path.basename(temp_file))
        w.files.upload(remote_path, f, overwrite=True)

    os.remove(temp_file)




