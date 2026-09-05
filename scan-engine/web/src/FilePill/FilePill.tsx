import type { ReactNode } from 'react';
import './FilePill.css';

export interface FilePillProps {
  /** Short glyph shown in the leading icon slot, e.g. "▦" or "⚙". */
  icon: ReactNode;
  name: string;
  /** Metadata line, e.g. "512×480 · 5cm/px". */
  meta: string;
  /** Status text on the right, e.g. "✓ 로드됨". */
  status?: string;
}

/** A single uploaded/attached file row, used in the new-project wizard. */
export function FilePill({ icon, name, meta, status = '✓ 로드됨' }: FilePillProps) {
  return (
    <div className="s2m-filepill">
      <div className="s2m-filepill__icon">{icon}</div>
      <div className="s2m-filepill__meta">
        <div className="s2m-filepill__name">{name}</div>
        <div className="s2m-filepill__size">{meta}</div>
      </div>
      {status ? <span className="s2m-filepill__status">{status}</span> : null}
    </div>
  );
}
