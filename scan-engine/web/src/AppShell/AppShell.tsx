import type { ReactNode } from 'react';
import './AppShell.css';

export interface NavItem {
  /** Short glyph/icon rendered before the label (e.g. "▦"). */
  icon: ReactNode;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}

export interface AppShellProps {
  brandName?: string;
  brandTagline?: string;
  /** Rendered on the right side of the top bar, e.g. a primary Button. */
  headerAction?: ReactNode;
  /** When provided, renders the 200px left side navigation. */
  navItems?: NavItem[];
  navTitle?: string;
  children: ReactNode;
}

/**
 * Top-level page shell shared by every scan-to-map-studio screen: brand bar
 * with an optional header action, plus an optional left side navigation.
 *
 * @example
 * <AppShell
 *   headerAction={<Button variant="primary">+ 새 프로젝트</Button>}
 *   navItems={[
 *     { icon: '▦', label: '프로젝트', active: true },
 *     { icon: '◧', label: '리포트 & 뷰어' },
 *   ]}
 * >
 *   <DashboardContent />
 * </AppShell>
 */
export function AppShell({
  brandName = 'scan-to-map-studio',
  brandTagline = 'LiDAR → 베이스맵 → 로봇 지도 정합',
  headerAction,
  navItems,
  navTitle = '메뉴',
  children,
}: AppShellProps) {
  return (
    <div className="s2m-shell">
      <div className="s2m-shell__topbar">
        <div className="s2m-shell__brand">
          <div className="s2m-shell__mark">S2M</div>
          <div>
            <div className="s2m-shell__name">{brandName}</div>
            <div className="s2m-shell__sub">{brandTagline}</div>
          </div>
        </div>
        {headerAction}
      </div>

      {navItems ? (
        <div className="s2m-shell__body">
          <nav className="s2m-shell__nav">
            <div className="s2m-shell__nav-title">{navTitle}</div>
            {navItems.map((item) => {
              const classes = ['s2m-nav-item', item.active ? 's2m-nav-item--active' : '']
                .filter(Boolean)
                .join(' ');
              return item.href ? (
                <a key={item.label} className={classes} href={item.href}>
                  <span className="s2m-nav-item__icon">{item.icon}</span>
                  {item.label}
                </a>
              ) : (
                <button key={item.label} type="button" className={classes} onClick={item.onClick}>
                  <span className="s2m-nav-item__icon">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="s2m-shell__main">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
