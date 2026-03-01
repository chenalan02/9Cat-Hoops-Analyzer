# 9Cat-Hoops-Analyzer

Docker
```bash
docker compose up # starts containers
docker compose up --build # build and starts containers if any env/dependency changes
docker compose up -d # starts containers in background
docker compose down # stop and removes containers
docker compose stop # pauses containers
```

Manual start backend
```bash
pipx install poetry
poetry lock # if you made changes to toml file
poetry install
eval $(poetry env activate) # activate virtual env in terminal
uvicorn main:app --reload # manual Startup Backend
```



