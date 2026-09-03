import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styles from './BottomTabs.module.css';

export interface TabDef { to: string; labelKey: string; badge?: number }

export function BottomTabs({ tabs }: { tabs: TabDef[] }) {
  const { t } = useTranslation();
  return (
    <nav className={styles.tabs} aria-label={t('nav.inbox')}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to} to={tab.to}
          className={({ isActive }) => (isActive ? `${styles.tab} ${styles.active}` : styles.tab)}
        >
          <span>{t(tab.labelKey)}</span>
          {tab.badge ? <span className={styles.badge}>{tab.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}
