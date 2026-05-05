import { CATEGORIES } from '../utils/zScore.js';
import './CategoryToggle.css';

/**
 * Category toggle chip bar for punt strategy.
 *
 * Props:
 *   puntedCats: Set<string>   — currently punted category keys
 *   onToggle: (key) => void   — toggle a category
 *   label?: string
 */
export default function CategoryToggle({ puntedCats, onToggle, label = 'Toggle Categories' }) {
  return (
    <div className="cat-toggle-section">
      <div className="cat-toggle-header">
        <span className="cat-toggle-label">{label}</span>
        <span className="cat-toggle-hint">
          Click to punt a category — ranking recalculates instantly
        </span>
      </div>
      <div className="toggle-bar" role="group" aria-label="Category punt toggles">
        {CATEGORIES.map(cat => {
          const punted = puntedCats.has(cat.key);
          return (
            <button
              key={cat.key}
              className={`toggle-chip ${punted ? 'punted' : 'active'}`}
              onClick={() => onToggle(cat.key)}
              aria-pressed={!punted}
              title={punted ? `Punting ${cat.label}` : `Including ${cat.label}`}
            >
              {cat.icon} {cat.key}
            </button>
          );
        })}
      </div>
      {puntedCats.size > 0 && (
        <p className="punt-summary">
          Punting <strong>{puntedCats.size}</strong> {puntedCats.size === 1 ? 'category' : 'categories'}:&nbsp;
          <span className="accent">{[...puntedCats].join(', ')}</span>
        </p>
      )}
    </div>
  );
}
