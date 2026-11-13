function InactiveTeamColumn({ teamName, titleColor, players }) {
  return (
    <div className="inactive-team">
      <h4 style={{ color: titleColor, marginBottom: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>
        {teamName}
      </h4>
      {players.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>No inactive or injured players</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {players.map(p => (
            <li key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '4px' }}>
              <span><strong>{p.name}</strong></span>
              <span style={{ color: 'var(--text-secondary)' }}>
                Status: <span className={`badge ${p.status ? 'badge-red' : 'badge-orange'}`} style={{ marginRight: '0.5rem' }}>{p.status || 'Active (0 GP)'}</span>
                Proj Games: <strong>{p.proj_games_played ?? 0}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function InactivePlayersSection({ myTeamName, oppTeamName, inactivePlayers }) {
  return (
    <div className="inactive-players-section card fade-up" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem' }}>
        ⚠️ Inactive &amp; Injured Players
      </h3>
      <p className="proj-subtitle" style={{ marginBottom: '1.25rem' }}>
        Players who are injured or projected for 0 games this week (excluded from active projections)
      </p>
      <div className="inactive-teams-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <InactiveTeamColumn teamName={myTeamName} titleColor="var(--accent)" players={inactivePlayers.team1} />
        <InactiveTeamColumn teamName={oppTeamName} titleColor="#ffa726" players={inactivePlayers.team2} />
      </div>
    </div>
  );
}
