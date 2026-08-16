import type { ReactNode } from 'react';
import './ProjectCard.css';

export type ProjectCardStatus = 'done' | 'progress' | 'needs-attention';

const STATUS_LABEL: Record<ProjectCardStatus, string> = {
  done: '완료',
  progress: '처리중',
  'needs-attention': '확인 필요',
};

export interface ProjectCardProps {
  /** Project name, e.g. "officescan" */
  title: string;
  /** Source file, scan size, date — e.g. "office.usdz · 20×20m · 2026-08-12" */
  meta: string;
  status: ProjectCardStatus;
  /** Number of the 6-step pipeline (import/preprocess/rasterize/register/classify/vectorize) completed. */
  stepsDone: number;
  stepsTotal?: number;
  /** Text under the step dots, e.g. "6/6 단계 · 정합 RMSE 3.1cm" */
  statusNote: string;
  /** Left side of the footer, e.g. "벽 7 · 가구 44" */
  footerStat: string;
  /** Footer action link/button label, e.g. "리포트 열기 →" */
  actionLabel: string;
  onAction?: () => void;
  /** Plan/preview graphic (SVG, image, spinner) shown in the thumbnail slot. */
  thumbnail?: ReactNode;
}

/** Project summary card for the scan-to-map-studio dashboard grid. */
export function ProjectCard({
  title,
  meta,
  status,
  stepsDone,
  stepsTotal = 6,
  statusNote,
  footerStat,
  actionLabel,
  onAction,
  thumbnail,
}: ProjectCardProps) {
  return (
    <div className="s2m-card">
      <div className="s2m-card__top">
        <div>
          <div className="s2m-card__title">{title}</div>
          <div className="s2m-card__meta">{meta}</div>
        </div>
        <span className={`s2m-badge s2m-badge--${status}`}>{STATUS_LABEL[status]}</span>
      </div>

      <div className="s2m-card__thumb">{thumbnail}</div>

      <div className="s2m-card__steps">
        {Array.from({ length: stepsTotal }, (_, i) => (
          <span
            key={i}
            className={`s2m-card__step-dot ${i < stepsDone ? 's2m-card__step-dot--on' : ''}`}
          />
        ))}
        <span className="s2m-card__step-note">{statusNote}</span>
      </div>

      <div className="s2m-card__foot">
        <span>{footerStat}</span>
        <button type="button" className="s2m-card__action" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

export interface NewProjectCardProps {
  title?: string;
  description?: string;
  onCreate?: () => void;
}

/** Dashed "start a new project" card — the last cell in the dashboard grid. */
export function NewProjectCard({
  title = '새 스캔으로 시작',
  description = '.usdz 드래그 또는 클릭해서 업로드',
  onCreate,
}: NewProjectCardProps) {
  return (
    <button type="button" className="s2m-card s2m-card--new" onClick={onCreate}>
      <div className="s2m-card__plus">+</div>
      <div className="s2m-card__new-title">{title}</div>
      <div className="s2m-card__new-desc">{description}</div>
    </button>
  );
}
