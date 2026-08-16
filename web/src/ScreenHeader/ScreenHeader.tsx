import type { ReactNode } from 'react';
import './ScreenHeader.css';

export type PillTone = 'accent' | 'success' | 'warn';

export interface ScreenHeaderProps {
  /** Breadcrumb segments, e.g. ["프로젝트", "officescan"]. Last segment is emphasized. */
  crumb: string[];
  /** Status pill text, e.g. "처리중 3 / 6" or "✓ 처리 완료". */
  pillText?: string;
  pillTone?: PillTone;
  /** Right-aligned actions, e.g. a row of Buttons. */
  actions?: ReactNode;
}

/** Thin top bar with a breadcrumb + status pill + right-aligned actions, used on pipeline/report screens. */
export function ScreenHeader({ crumb, pillText, pillTone = 'accent', actions }: ScreenHeaderProps) {
  return (
    <div className="s2m-screen-header">
      <div className="s2m-screen-header__crumb">
        {crumb.map((part, i) => (
          <span key={i} className={i === crumb.length - 1 ? 's2m-screen-header__proj' : 's2m-screen-header__dim'}>
            {part}
            {i < crumb.length - 1 ? <span className="s2m-screen-header__dim"> / </span> : null}
          </span>
        ))}
        {pillText ? <span className={`s2m-pill s2m-pill--${pillTone}`}>{pillText}</span> : null}
      </div>
      {actions ? <div className="s2m-screen-header__actions">{actions}</div> : null}
    </div>
  );
}
