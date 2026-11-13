import { useContext } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { TeamDataContext } from '../App.jsx';
import YahooRefreshButton from './common/YahooRefreshButton.jsx';
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
  const canRefresh = Boolean(leagueData || fantasyLink);

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
          <YahooRefreshButton
            loading={loading}
            onRefresh={refreshTeam}
            className="nav-refresh-btn"
            idleLabel="Reload Yahoo"
            labelClassName="nav-refresh-label"
          />
        )}
      </div>
    </nav>
  );
}
