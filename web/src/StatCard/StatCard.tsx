import type { ReactNode } from 'react';
import './StatCard.css';

export interface SidePanelProps {
  children: ReactNode;
}

/** 270px right-hand side panel shell used on the pipeline/report screens. */
export function SidePanel({ children }: SidePanelProps) {
  return <div className="s2m-side">{children}</div>;
}

export interface SidePanelSectionProps {
  title: string;
  children: ReactNode;
}

/** Titled section inside a {@link SidePanel} (e.g. "요약", "산출물"). */
export function SidePanelSection({ title, children }: SidePanelSectionProps) {
  return (
    <div>
      <div className="s2m-side__title">{title}</div>
      {children}
    </div>
  );
}

export interface Stat {
  value: string;
  label: string;
}

export interface StatGridProps {
  stats: Stat[];
}

/** 2-column grid of number+label stat tiles (e.g. point count, wall count). */
export function StatGrid({ stats }: StatGridProps) {
  return (
    <div className="s2m-stat-grid">
      {stats.map((s) => (
        <div key={s.label} className="s2m-stat">
          <div className="s2m-stat__n">{s.value}</div>
          <div className="s2m-stat__l">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
