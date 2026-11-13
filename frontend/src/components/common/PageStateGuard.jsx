export function LoadingView({ message = 'Loading…' }) {
  return (
    <div className="page-wrapper center-content">
      <div className="spinner" style={{ width: 36, height: 36 }} />
      <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>{message}</p>
    </div>
  );
}

export function EmptyState({
  icon = '🏀',
  title,
  description,
  actionLabel = 'Go to Home',
  onAction,
}) {
  return (
    <div className="page-wrapper center-content">
      <div className="empty-state">
        <div style={{ fontSize: '4rem' }}>{icon}</div>
        <h2 style={{ marginBottom: '0.5rem' }}>{title}</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          {description}
        </p>
        {onAction && (
          <button className="btn-primary" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
