import { useContext, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import './Nav.css';

const LINKS = [
  { to: '/',                label: 'Home',                  exact: true },
  { to: '/your-team',       label: 'My Team'                            },
  { to: '/league-rankings', label: 'League Power Rankings'              },
  { to: '/matchup',         label: 'Matchup'                            },
  { to: '/streamers',       label: 'Streamers'                          },
  { to: '/trade',           label: 'Trade'                              },
  { to: '/draft',           label: 'Draft'                              },
  { to: '/info',            label: 'Info'                               },
];

export default function Nav() {
  const navigate = useNavigate();
  const { leagueData, fantasyLink, refreshTeam, loading } = useContext(TeamDataContext) || {};
  const [justRefreshed, setJustRefreshed] = useState(false);

  const canRefresh = Boolean(leagueData || fantasyLink);

  const handleRefresh = async () => {
    if (loading || !refreshTeam) return;
    try {
      await refreshTeam();
      setJustRefreshed(true);
      setTimeout(() => setJustRefreshed(false), 2500);
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  };

  return (
    <nav className="nav" aria-label="Main navigation">
      <div className="nav-left">
        <button
          className="nav-logo"
          onClick={() => navigate('/')}
          aria-label="Go to homepage"
        >
          <span className="logo-icon">🏀</span>
          <span>9Cat <span className="accent">Hoops</span></span>
        </button>
      </div>

      <ul className="nav-links" role="list">
        {LINKS.map(link => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.exact}
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="nav-actions">
        {canRefresh && (
          <button
            type="button"
            className={`nav-refresh-btn ${loading ? 'loading' : ''} ${justRefreshed ? 'success' : ''}`}
            onClick={handleRefresh}
            disabled={loading}
            title="Reload latest team roster, matchups, and league data from Yahoo Fantasy"
          >
            <span className={`refresh-icon ${loading ? 'spinning' : ''}`}>🔄</span>
            <span className="nav-refresh-label">
              {loading ? 'Reloading…' : justRefreshed ? 'Updated!' : 'Reload Yahoo'}
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
