import './ToggleLegend.css';

export interface LegendItem {
  /** CSS color for the swatch, e.g. "var(--wall)" or "#ef4444". */
  color: string;
  label: string;
  on?: boolean;
  onToggle?: () => void;
  round?: boolean;
}

export interface ToggleLegendProps {
  items: LegendItem[];
}

/** Row of color-swatch legend toggles (walls/furniture/trajectory/registration overlay) above the map canvas. */
export function ToggleLegend({ items }: ToggleLegendProps) {
  return (
    <div className="s2m-toolbar">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`s2m-toggle-row ${item.on === false ? 's2m-toggle-row--off' : ''}`}
          onClick={item.onToggle}
        >
          <span
            className="s2m-swatch"
            style={{ background: item.color, borderRadius: item.round ? '50%' : undefined }}
          />
          {item.label}
        </button>
      ))}
    </div>
  );
}
