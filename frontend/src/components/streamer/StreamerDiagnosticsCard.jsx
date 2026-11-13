function formatCatLabel(k) {
  return k === 'fg3m' ? '3PM' : k.toUpperCase();
}

export default function StreamerDiagnosticsCard({ categories = {}, streamerLoading, onRefresh }) {
  const entries = Object.entries(categories);
  const safe = entries.filter(([, d]) => d.status === 'SAFE');
  const swing = entries.filter(([, d]) => d.status === 'SWING');
  const doomed = entries.filter(([, d]) => d.status === 'DOOMED');
  const punted = entries.filter(([, d]) => d.status === 'PUNTED' || d.is_punted);

  return (
    <div className="streamer-diag-card card">
      <div className="streamer-diag-header">
        <div>
          <div className="streamer-diag-title">Category Matchup Diagnostics</div>
          <div className="streamer-diag-subtitle">
            Prioritizes contested swing categories (15%–85%) while skipping your punted categories.
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost streamer-refresh-btn"
          onClick={onRefresh}
          disabled={streamerLoading}
          title="Refresh free agent stream recommendations"
        >
          🔄 Refresh Streamers
        </button>
      </div>

      <div className={`streamer-triage-grid ${punted.length > 0 ? 'has-punts' : ''}`}>
        <div className="triage-column safe">
          <div className="triage-column-header">
            <span className="triage-status-dot safe" />
            <span>Safe Leads (Protect)</span>
          </div>
          <div className="triage-tags">
            {safe.map(([k, d]) => (
              <span key={k} className="triage-tag safe" title={`Win Prob: ${Math.round(d.p_win * 100)}%`}>
                <strong>{formatCatLabel(k)}</strong> {Math.round(d.p_win * 100)}%
              </span>
            ))}
          </div>
        </div>

        <div className="triage-column swing">
          <div className="triage-column-header">
            <span className="triage-status-dot swing" />
            <span>Contested Battles (Targets)</span>
          </div>
          <div className="triage-tags">
            {swing.map(([k, d]) => (
              <span key={k} className="triage-tag swing" title={`Margin: ${d.margin > 0 ? '+' : ''}${d.margin}`}>
                <strong>{formatCatLabel(k)}</strong> {Math.round(d.p_win * 100)}% ({d.margin > 0 ? '+' : ''}{d.margin})
              </span>
            ))}
          </div>
        </div>

        <div className="triage-column doomed">
          <div className="triage-column-header">
            <span className="triage-status-dot doomed" />
            <span>Trailing / Longshots</span>
          </div>
          <div className="triage-tags">
            {doomed.map(([k, d]) => (
              <span key={k} className="triage-tag doomed" title={`Win Prob: ${Math.round(d.p_win * 100)}%`}>
                <strong>{formatCatLabel(k)}</strong> {Math.round(d.p_win * 100)}%
              </span>
            ))}
          </div>
        </div>

        {punted.length > 0 && (
          <div className="triage-column punted">
            <div className="triage-column-header">
              <span className="triage-status-dot punted" />
              <span>Punted by You</span>
            </div>
            <div className="triage-tags">
              {punted.map(([k]) => (
                <span key={k} className="triage-tag punted" title="Excluded from streamer ΔE calculation">
                  <strong>{formatCatLabel(k)}</strong> PUNT
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
