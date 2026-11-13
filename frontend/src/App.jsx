import { createContext, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import HomePage from './pages/HomePage.jsx';
import { useTeamData } from './hooks/useTeamData.js';

const YourTeamPage       = lazy(() => import('./pages/YourTeamPage.jsx'));
const LeagueRankingsPage = lazy(() => import('./pages/LeagueRankingsPage.jsx'));
const MatchupPage        = lazy(() => import('./pages/MatchupPage.jsx'));
const StreamerPage       = lazy(() => import('./pages/StreamerPage.jsx'));
const DraftPage          = lazy(() => import('./pages/DraftPage.jsx'));
const TradePage          = lazy(() => import('./pages/TradePage.jsx'));
const InfoPage           = lazy(() => import('./pages/InfoPage.jsx'));

export const TeamDataContext = createContext(null);

export default function App() {
  const teamData = useTeamData();

  return (
    <TeamDataContext.Provider value={teamData}>
      <BrowserRouter>
        <Nav />
        <Suspense fallback={
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
            <span className="spinner" style={{ width: 28, height: 28 }} />
          </div>
        }>
          <Routes>
            <Route path="/"                element={<HomePage />} />
            <Route path="/your-team"       element={<YourTeamPage />} />
            <Route path="/league-rankings" element={<LeagueRankingsPage />} />
            <Route path="/matchup"         element={<MatchupPage />} />
            <Route path="/streamers"       element={<StreamerPage />} />
            <Route path="/draft"           element={<DraftPage />} />
            <Route path="/trade"           element={<TradePage />} />
            <Route path="/info"            element={<InfoPage />} />
            {/* Catch-all */}
            <Route path="*" element={<HomePage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TeamDataContext.Provider>
  );
}
