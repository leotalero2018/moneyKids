import { useTranslation } from 'react-i18next';

export function Spinner() {
  const { t } = useTranslation();
  return <p role="status">{t('common.loading')}</p>;
}
