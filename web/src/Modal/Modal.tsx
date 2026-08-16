import type { ReactNode } from 'react';
import './Modal.css';

export interface ModalProps {
  title: string;
  onClose?: () => void;
  /** Rendered in the footer, e.g. a row of Buttons. */
  footer?: ReactNode;
  children: ReactNode;
}

/** Centered dialog shell (backdrop + header + body + footer) used by the new-project wizard. */
export function Modal({ title, onClose, footer, children }: ModalProps) {
  return (
    <div className="s2m-modal-backdrop">
      <div className="s2m-modal">
        <div className="s2m-modal__head">
          <div className="s2m-modal__title">{title}</div>
          <button type="button" className="s2m-modal__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="s2m-modal__body">{children}</div>
        {footer ? <div className="s2m-modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}
