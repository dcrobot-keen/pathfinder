import type { ReactNode } from 'react';
import './Dropzone.css';

export interface DropzoneProps {
  /** Main line, e.g. <>‌<b>robot_map.pgm</b> + <b>robot_map.yaml</b> 드래그, 또는 클릭해서 선택</> */
  label: ReactNode;
  /** Format/requirement hint below the label. */
  hint?: ReactNode;
  onClick?: () => void;
}

/** Dashed file drop target used in upload steps. */
export function Dropzone({ label, hint, onClick }: DropzoneProps) {
  return (
    <div className="s2m-dropzone" onClick={onClick} role="button" tabIndex={0}>
      <div className="s2m-dropzone__label">{label}</div>
      {hint ? <div className="s2m-dropzone__hint">{hint}</div> : null}
    </div>
  );
}
