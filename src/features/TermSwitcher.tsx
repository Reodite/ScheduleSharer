import type { Term } from './terms';

interface Props {
  terms: Term[];
  selected: string | null;
  onSelect: (key: string) => void;
}

export function TermSwitcher({ terms, selected, onSelect }: Props) {
  if (terms.length === 0) return null;
  if (terms.length === 1) {
    return <span className="wordmark__tag">{terms[0].label}</span>;
  }
  return (
    <div className="terms">
      {terms.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`terms__opt${t.key === selected ? ' terms__opt--active' : ''}`}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
