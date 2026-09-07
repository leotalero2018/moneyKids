import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { callables } from '../lib/callables.js';
import { useFirebase } from '../firebase/FirebaseContext.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import styles from './SignIn.module.css';

export function JoinParent() {
  const { t } = useTranslation();
  const fb = useFirebase();
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setFailed(false);
    try {
      await callables(fb).acceptParentInvite({ code: code.trim().toUpperCase() });
      // the session's parentIndex listener picks up the new pointer on its own
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <h1>{t('joinParent.title')}</h1>
      {failed && <ErrorBanner message={t('joinParent.failed')} />}
      <label htmlFor="invite-code">{t('joinParent.code')}</label>
      <input
        id="invite-code" value={code} autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value)}
      />
      <Button disabled={busy} onClick={join}>{t('joinParent.submit')}</Button>
    </main>
  );
}
