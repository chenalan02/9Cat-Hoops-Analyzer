export default function SortIcon({ active, dir }) {
  if (!active) return <span className="sort-icon">⇅</span>;
  return <span className="sort-icon active">{dir === 'asc' ? '↑' : '↓'}</span>;
}
