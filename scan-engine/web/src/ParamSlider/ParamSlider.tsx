import './ParamSlider.css';

export interface ParamSliderProps {
  label: string;
  /** Formatted value shown on the right, e.g. "5.0 cm". */
  valueLabel: string;
  /** 0–100, position of the fill/knob. */
  percent: number;
}

/** Labeled parameter slider (display-only) for pipeline stage settings, e.g. grid resolution. */
export function ParamSlider({ label, valueLabel, percent }: ParamSliderProps) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div className="s2m-param">
      <div className="s2m-param__row">
        <span>{label}</span>
        <span className="s2m-param__val">{valueLabel}</span>
      </div>
      <div className="s2m-param__track">
        <div className="s2m-param__fill" style={{ width: `${pct}%` }} />
        <div className="s2m-param__knob" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}
