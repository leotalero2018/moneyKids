import { useTranslation } from 'react-i18next';
import styles from './Celebrate.module.css';

/** Small, brief, and silent — and it respects prefers-reduced-motion. */
export function Celebrate() {
  const { t } = useTranslation();
  return (
    <p role="status" data-testid="celebrate" className={styles.celebrate}>
      🎉 {t('kidNegotiation.celebrate')}
    </p>
  );
}
