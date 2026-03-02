# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

if __name__ == "__main__":

    app = FastAPI()

    # --- THE CORS FIX (Security Guard) ---
    # Allow your local frontend to talk to this local backend
    origins = [
        "http://127.0.0.1:5500", # Common port for VS Code Live Server
        "http://localhost:5500",
        # Add your friend's React port here later (e.g., http://localhost:3000)
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"], # Allow GET, POST, DELETE, etc.
        allow_headers=["*"],
    )

    # --- THE "CONTRACT" (Data Structure) ---
    # Define what the incoming data looks like
    class TeamRequest(BaseModel):
        fantasy_link: str

    @app.get("/")
    def home():
        return {"message": "Basketball API is running. Go to /docs"}

    # --- THE ENDPOINT (The Command) ---
    # We use POST because we are SENDING data to be processed
    @app.post("/analyze-team")
    async def analyze_team_link(request: TeamRequest):
        
        # 1. Capture the link sent by the frontend
        received_link = request.fantasy_link
        print(f"DEBUG: Received link to scrape: {received_link}")
        
        # 2. (Future Logic) In Mechatronics terms: 
        # This is where you would activate the actuators (scrapers/models)
        
        # 3. Send back a success signal.
        # We send an empty data object for now, just to trigger the frontend change.
        return {
            "status": "success",
            "message": "Link received!",
            "payload": {} # Placeholder for actual player stats later
        }