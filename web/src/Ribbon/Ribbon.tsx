import type { ReactNode } from 'react';
import './Ribbon.css';

export interface RibbonTab {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export interface RibbonProps {
  tabs: RibbonTab[];
}

/**
 * Top tab row, adapted from the FJD Trion Model benchmark (PLAN.md §7:
 * Start/Edit/Display) into this project's own pipeline phases.
 *
 * @example
 * <Ribbon tabs={[{ label: '처리 (Process)', active: true }, { label: '편집 (분류·벡터화)' }, { label: '디스플레이' }]} />
 */
export function Ribbon({ tabs }: RibbonProps) {
  return (
    <div className="s2m-ribbon">
      {tabs.map((tab) => (
        <button
          key={tab.label}
          type="button"
          className={`s2m-ribbon__tab ${tab.active ? 's2m-ribbon__tab--active' : ''}`}
          onClick={tab.onClick}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export interface RibbonTool {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}

export interface RibbonToolsProps {
  tools: RibbonTool[];
}

/** Icon toolbar row shown under the {@link Ribbon} tabs. */
export function RibbonTools({ tools }: RibbonToolsProps) {
  return (
    <div className="s2m-ribbon-tools">
      {tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          className="s2m-ribbon-tool"
          disabled={tool.disabled}
          onClick={tool.onClick}
        >
          <span className="s2m-ribbon-tool__icon">{tool.icon}</span>
          {tool.label}
        </button>
      ))}
    </div>
  );
}
