import { useTranslation } from 'react-i18next';
import styles from './ErrorBanner.module.css';

export function ErrorBanner({ message }: { message?: string }) {
  const { t } = useTranslation();
  return <p role="alert" className={styles.banner}>{message ?? t('common.error')}</p>;
}
