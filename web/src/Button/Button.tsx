import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Defaults to the neutral panel button. */
  variant?: ButtonVariant;
  children: ReactNode;
}

/**
 * Primary action button for scan-to-map-studio screens (dashboard header
 * actions, wizard footer nav, ribbon/toolbar buttons).
 *
 * @example
 * <Button variant="primary">+ 새 프로젝트</Button>
 * <Button variant="danger">취소</Button>
 */
export function Button({ variant = 'default', className, children, ...rest }: ButtonProps) {
  const classes = ['s2m-btn', `s2m-btn--${variant}`, className].filter(Boolean).join(' ');
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
