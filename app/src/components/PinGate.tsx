import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isParentViewLocked, unlockParentView } from '../lib/pin.js';
import { Button } from './Button.js';
import { ErrorBanner } from './ErrorBanner.js';

export function PinGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState(() => isParentViewLocked());
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  if (!locked) return <>{children}</>;

  return (
    <main>
      <h1>{t('pin.title')}</h1>
      {wrong && <ErrorBanner message={t('pin.wrong')} />}
      <label htmlFor="pin-entry">{t('pin.enter')}</label>
      <input
        id="pin-entry" type="password" inputMode="numeric" value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      <Button
        onClick={async () => {
          if (await unlockParentView(pin)) {
            setLocked(false);
            setWrong(false);
          } else {
            setWrong(true);
          }
        }}
      >
        {t('pin.submit')}
      </Button>
    </main>
  );
}
