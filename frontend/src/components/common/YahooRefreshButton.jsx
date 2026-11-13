import { useEffect, useRef, useState } from 'react';

export default function YahooRefreshButton({
  loading,
  onRefresh,
  className = 'btn-secondary refresh-btn',
  idleLabel = 'Reload from Yahoo',
  labelClassName = '',
  title = 'Reload latest team roster, matchups, and league data from Yahoo Fantasy',
  onSuccess,
}) {
  const [justRefreshed, setJustRefreshed] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = async () => {
    if (loading || !onRefresh) return;
    const result = await onRefresh();
    if (!result) return;

    if (onSuccess) onSuccess(result);
    setJustRefreshed(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setJustRefreshed(false), 2500);
  };

  return (
    <button
      type="button"
      className={`${className} ${loading ? 'loading' : ''} ${justRefreshed ? 'success' : ''}`.trim()}
      onClick={handleClick}
      disabled={loading}
      title={title}
    >
      <span className={`refresh-icon ${loading ? 'spinning' : ''}`}>🔄</span>
      <span className={labelClassName || undefined}>
        {loading ? 'Reloading…' : justRefreshed ? 'Updated!' : idleLabel}
      </span>
    </button>
  );
}
