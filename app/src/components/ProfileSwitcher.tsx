import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { hasPin, lockParentView } from '../lib/pin.js';
import { Button } from './Button.js';
import { ErrorBanner } from './ErrorBanner.js';

/**
 * Both sessions stay signed in — that is the point of two Firebase instances.
 * Handing the phone over only locks the parent VIEW; the parent's session is
 * still live underneath, exactly as the spec's threat model describes, and no
 * rule or callable trusts this lock.
 */
export function ProfileSwitcher({ direction }: { direction: 'to-kid' | 'to-parent' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  if (direction === 'to-parent') {
    // no PIN check here: PinGate guards the parent shell itself, so a kid
    // tapping this lands on the prompt rather than in the parent view
    return (
      <Button variant="secondary" onClick={() => navigate('/')}>
        {t('switcher.toParent')}
      </Button>
    );
  }

  return (
    <>
      {error && <ErrorBanner message={error} />}
      <Button
        variant="secondary"
        onClick={() => {
          // locking with no PIN set is a no-op, which would hand a kid an
          // unlocked parent view — refuse instead of pretending
          if (!hasPin()) {
            setError(t('switcher.needPin'));
            return;
          }
          lockParentView();
          navigate('/kid');
        }}
      >
        {t('switcher.toKid')}
      </Button>
    </>
  );
}
