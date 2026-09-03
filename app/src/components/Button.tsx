import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'danger';

export function Button(
  { variant = 'primary', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant },
) {
  return <button className={`${styles.button} ${styles[variant]}`} {...rest} />;
}
