import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signInWithCustomToken } from 'firebase/auth';
import { kidBundle } from '../../firebase.js';
import { callables } from '../../lib/callables.js';
import { endKidSession } from '../../kid/kidSessionReset.js';
import { Button } from '../../components/Button.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import styles from '../SignIn.module.css';

export function JoinKid() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setFailed(false);
    setError(null);
    try {
      // a different kid may be taking over this device; start from a cache
      // that has never seen the previous kid's documents. If the erasure
      // failed, refuse the sign-in rather than seat Kid B on Kid A's cache.
      if (kidBundle().auth.currentUser) {
        try {
          await endKidSession();
        } catch {
          setError(t('kidJoin.reopen'));
          return;
        }
      }
      // uppercase here so a kid typing lowercase still works; the callable
      // validates the exact alphabet and rejects anything else
      const fb = kidBundle();
      const { data } = await callables(fb).mintKidToken({ code: code.trim().toUpperCase() });
      await signInWithCustomToken(fb.auth, data.token);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <h1>{t('kidJoin.title')}</h1>
      <p>{t('kidJoin.help')}</p>
      {failed && <ErrorBanner message={t('kidJoin.failed')} />}
      {error && <ErrorBanner message={error} />}
      <label htmlFor="kid-code">{t('kidJoin.code')}</label>
      <input
        id="kid-code" value={code} autoCapitalize="characters" autoComplete="off"
        onChange={(e) => setCode(e.target.value)}
      />
      <Button disabled={busy} onClick={join}>{t('kidJoin.submit')}</Button>
    </main>
  );
}
