# 9Cat-Hoops-Analyzer

Start container
```bash
docker compose up
```

Start container in background
```bash
docker compose up -d
```

Stop and removes containers
```bash
docker compose down
```

Pauses containers
```bash
docker compose stop
```

Manual Python setup
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Manual Startup Backend
```bash
uvicorn main:app --reload
```


