import os
import pandas as pd
from datetime import datetime, timedelta
from nba_api.stats.endpoints import scheduleleaguev2
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



