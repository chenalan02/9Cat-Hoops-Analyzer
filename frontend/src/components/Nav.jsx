import { NavLink, useNavigate } from 'react-router-dom';
import './Nav.css';

const LINKS = [
  { to: '/',                label: 'Home',    exact: true },
  { to: '/your-team',       label: 'My Team'              },
  { to: '/league-rankings', label: 'League'               },
  { to: '/matchup',         label: 'Matchup'              },
  { to: '/draft',           label: 'Draft'                },
  { to: '/info',            label: 'Info'                 },
];

export default function Nav() {
  const navigate = useNavigate();

  return (
    <nav className="nav" aria-label="Main navigation">
      <button
        className="nav-logo"
        onClick={() => navigate('/')}
        aria-label="Go to homepage"
      >
        <span className="logo-icon">🏀</span>
        <span>9Cat <span className="accent">Hoops</span></span>
      </button>

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
    </nav>
  );
}
