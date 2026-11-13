export default function MatchupSelectorCard({
  leagueData,
  myTeam,
  opponents,
  oppTeam,
  oppTeamId,
  scheduledOppId,
  weekNum,
  dateStart,
  showOverrides,
  setShowOverrides,
  analysisLoading,
  analysisError,
  mcLoading,
  onSelectMyTeam,
  onSelectOpponent,
  onSelectWeek,
  onOverrideWeek,
  onOverrideDate,
  onAnalyze,
  onRunMonteCarlo,
  onOpenStreamers,
}) {
  return (
    <div className="matchup-selector card">
      <div className="matchup-vs">
        <div className="vs-team">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="badge badge-green">You</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Your Team)</span>
          </div>
          <select
            className="opp-select"
            value={myTeam?.team_id ?? ''}
            onChange={e => onSelectMyTeam(parseInt(e.target.value, 10))}
            aria-label="Select your team"
          >
            {leagueData?.teams?.map(t => (
              <option key={t.team_id} value={t.team_id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <span className="vs-divider">VS</span>

        <div className="vs-team">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="badge badge-orange">Opponent</span>
            {oppTeam && String(oppTeam.team_id) === String(scheduledOppId) && (
              <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>⚔️ Scheduled Matchup</span>
            )}
          </div>
          <select
            className="opp-select"
            value={oppTeamId}
            onChange={e => onSelectOpponent(e.target.value)}
            aria-label="Select opponent team"
          >
            <option value="">— Select opponent —</option>
            {opponents.map(t => (
              <option key={t.team_id} value={t.team_id}>
                {t.name}{String(t.team_id) === String(scheduledOppId) ? " (This Week's Matchup ⚔️)" : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="matchup-controls" style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              Matchup Week
            </span>
            <select
              className="matchup-input week-select"
              value={weekNum}
              onChange={e => onSelectWeek(parseInt(e.target.value, 10) || 1)}
              style={{ width: 'auto', minWidth: '130px', padding: '8px 12px', fontWeight: 700, fontSize: '0.92rem' }}
              aria-label="Select matchup week number"
            >
              {Array.from({ length: 24 }, (_, i) => i + 1).map(w => (
                <option key={w} value={w}>
                  Week {w}{w === (leagueData?.week_num ?? 1) ? ' (Current)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={() => setShowOverrides(!showOverrides)}
            style={{ padding: '8px 16px', fontSize: '0.85rem' }}
          >
            {showOverrides ? '⚙️ Hide Options' : '⚙️ Advanced Options'}
          </button>

          {oppTeam && (
            <>
              <button
                className="btn-primary"
                onClick={onAnalyze}
                disabled={analysisLoading}
                style={{ padding: '8px 18px', fontSize: '0.85rem' }}
              >
                {analysisLoading ? <><span className="spinner" /> Refreshing…</> : '🔄 Re-analyze'}
              </button>

              <button
                className="btn-monte-carlo"
                onClick={onRunMonteCarlo}
                disabled={mcLoading}
                id="run-monte-carlo-btn"
              >
                {mcLoading ? <><span className="spinner" /> Running 10k…</> : '🎲 Run Monte Carlo'}
              </button>

              <button
                type="button"
                className="btn-ghost"
                onClick={onOpenStreamers}
                style={{ padding: '8px 16px', fontSize: '0.85rem', border: '1px solid var(--border)' }}
                title="View automated streamer recommendations for this matchup"
              >
                🎯 Streamer Suggestions →
              </button>
            </>
          )}
        </div>
      </div>

      {showOverrides && (
        <div className="card fade-up" style={{ marginTop: '1.5rem', padding: '1.5rem', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border)' }}>
          <h4 style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--accent)', marginTop: 0 }}>⚙️ Advanced Simulation Overrides</h4>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <label className="matchup-control-label" style={{ flex: 1, minWidth: '150px' }}>
              <span>Matchup Week Number</span>
              <input
                type="number"
                min="1"
                max="30"
                value={weekNum}
                onChange={e => onOverrideWeek(parseInt(e.target.value, 10) || 1)}
                className="matchup-input"
                aria-label="Override matchup week number"
              />
            </label>
            <label className="matchup-control-label" style={{ flex: 1, minWidth: '150px' }}>
              <span>Simulation Start Date</span>
              <input
                type="date"
                value={dateStart}
                onChange={e => onOverrideDate(e.target.value)}
                className="matchup-input"
                aria-label="Override matchup start date"
              />
            </label>
          </div>
        </div>
      )}

      {analysisLoading && (
        <div className="analysis-loading" style={{ marginTop: '1.5rem', padding: '2.5rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
          <span className="spinner" style={{ width: '32px', height: '32px', borderWidth: '3px' }} />
          <div style={{ fontWeight: 600, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
            Analyzing Matchup &amp; Solving Lineups…
          </div>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Processing weekly schedule, player statistical distributions, and 9-cat probabilities
          </span>
        </div>
      )}

      {analysisError && (
        <p className="input-error" role="alert" style={{ marginTop: '1rem' }}>
          ⚠️ {analysisError}
        </p>
      )}
    </div>
  );
}
