import { createContext, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import HomePage from './pages/HomePage.jsx';
import YourTeamPage from './pages/YourTeamPage.jsx';
import LeagueRankingsPage from './pages/LeagueRankingsPage.jsx';
import MatchupPage from './pages/MatchupPage.jsx';
import InfoPage from './pages/InfoPage.jsx';
import DraftPage from './pages/DraftPage.jsx';
import TradePage from './pages/TradePage.jsx';
import { useTeamData } from './hooks/useTeamData.js';

export const TeamDataContext = createContext(null);

export default function App() {
  const teamData = useTeamData();

  return (
    <TeamDataContext.Provider value={teamData}>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/"                element={<HomePage />} />
          <Route path="/your-team"       element={<YourTeamPage />} />
          <Route path="/league-rankings" element={<LeagueRankingsPage />} />
          <Route path="/matchup"         element={<MatchupPage />} />
          <Route path="/draft"           element={<DraftPage />} />
          <Route path="/trade"           element={<TradePage />} />
          <Route path="/info"            element={<InfoPage />} />
          {/* Catch-all */}
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </TeamDataContext.Provider>
  );
}
