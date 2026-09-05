import './StepRail.css';

export type RailStepStatus = 'done' | 'active' | 'pending' | 'skip' | 'error';

export interface RailStep {
  /** e.g. "1. 가져오기" */
  title: string;
  /** e.g. "usdz_to_ply · 1.27M pts" */
  subtitle: string;
  status: RailStepStatus;
  onClick?: () => void;
}

export interface StepRailProps {
  steps: RailStep[];
}

const DOT_CONTENT: Record<RailStepStatus, string> = {
  done: '✓',
  active: '●',
  pending: '',
  skip: '–',
  error: '!',
};

/** Vertical numbered pipeline step list (import → preprocess → rasterize → register → classify → vectorize). */
export function StepRail({ steps }: StepRailProps) {
  return (
    <nav className="s2m-rail">
      {steps.map((step, i) => (
        <button
          key={step.title}
          type="button"
          className={`s2m-rail-item ${step.status === 'active' ? 's2m-rail-item--active' : ''}`}
          onClick={step.onClick}
        >
          <span className={`s2m-rail-dot s2m-rail-dot--${step.status}`}>
            {step.status === 'pending' ? i + 1 : DOT_CONTENT[step.status]}
          </span>
          <span>
            <div className="s2m-rail-label__t">{step.title}</div>
            <div className="s2m-rail-label__s">{step.subtitle}</div>
          </span>
        </button>
      ))}
    </nav>
  );
}
