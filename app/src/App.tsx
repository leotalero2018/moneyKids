import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return <main>{t('nav.inbox')}</main>;
}
