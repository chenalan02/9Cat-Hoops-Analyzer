# 9-Cat Hoops Live Draft Analyzer Chrome Extension

A Manifest V3 Chrome Extension providing real-time 9-category statistical overlays, punt strategy toggles, dynamic z-score rankings, and live draft pick recommendations directly inside Yahoo Fantasy and ESPN Fantasy draft rooms.

---

## Features

- **Live Draft Overlay**: Floating, sleek dark-mode glassmorphism widget inside live draft pages.
- **Punt Strategy Recalculation**: Instantly re-calculates player Z-scores when punting any combination of the 9 categories (PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO).
- **Auto-Draft Detection**: Monitors DOM changes to remove drafted players from your available pool.
- **Standalone Offline Engine**: Contains baseline player projections and delta-method percentage variance scoring built-in.
- **Backend Sync**: Optionally connects to the local `9Cat-Hoops-Analyzer` FastAPI server (`http://localhost:8000`).

---

## Installation Guide (Chrome / Edge / Brave)

1. Open **Google Chrome** (or Edge/Brave) and navigate to `chrome://extensions`.
2. Toggle **Developer mode** ON in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the directory:
   `c:\Users\Micha\9cathoopsProject\9Cat-Hoops-Analyzer\chrome_extension`
5. The extension **"9-Cat Hoops Live Draft Analyzer"** will appear in your extensions list and toolbar.

---

## Usage

1. Open your **Yahoo Fantasy Basketball** or **ESPN Fantasy Basketball** Live Draft room.
2. Look for the floating button: **`⚡ 9-Cat Draft Analyzer`** at the bottom-right of your screen.
3. Click the button to toggle the live assistant drawer.
4. Toggle **Punt categories** to watch player rankings re-adjust in real time.
5. Click **Drafted** next to any player if manual mark-off is needed.
