import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { cx } from '../cx';
import { buttonClass, type StyleProps } from './button-class';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & StyleProps;

export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx(buttonClass({ variant, size }), className)} {...rest} />;
}

export type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & StyleProps;

/** An anchor styled as a button, for navigation actions. */
export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps) {
  return <a className={cx(buttonClass({ variant, size }), className)} {...rest} />;
}
