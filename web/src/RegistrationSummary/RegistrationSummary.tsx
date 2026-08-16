import './RegistrationSummary.css';

export interface RegistrationSummaryProps {
  title?: string;
  /** e.g. [["회전", "42.3°"], ["이동", "1.84, 3.02 m"], ["RMSE", "3.1 cm"]] */
  rows: [label: string, value: string][];
}

/** Green success box summarizing a 2D ICP registration result (rotation/translation/RMSE). */
export function RegistrationSummary({ title = '✓ 로봇 지도 정합 성공', rows }: RegistrationSummaryProps) {
  return (
    <div className="s2m-reg">
      <div className="s2m-reg__title">{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} className="s2m-reg__row">
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}
