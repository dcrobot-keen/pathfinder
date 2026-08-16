import './StepIndicator.css';

export type StepState = 'done' | 'active' | 'pending';

export interface Step {
  label: string;
  state: StepState;
}

export interface StepIndicatorProps {
  steps: Step[];
}

/** Horizontal wizard step indicator (e.g. "이름 → 로봇 지도 → 처리 옵션"). */
export function StepIndicator({ steps }: StepIndicatorProps) {
  return (
    <div className="s2m-steps">
      {steps.map((step, i) => (
        <div key={step.label} className={`s2m-steps__item s2m-steps__item--${step.state}`}>
          <span className="s2m-steps__n">{step.state === 'done' ? '✓' : i + 1}</span>
          {step.label}
        </div>
      ))}
    </div>
  );
}
