import type { ReactNode } from 'react';
import styles from './Card.module.css';

export function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section role="group" aria-label={label} className={styles.card}>
      {children}
    </section>
  );
}
