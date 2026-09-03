import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup,
} from 'firebase/auth';
import { auth } from '../firebase.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import styles from './SignIn.module.css';

export function SignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      // the specific Firebase code is deliberately not shown: it distinguishes
      // "no such account" from "wrong password", which is an enumeration leak
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <h1>{t('signIn.title')}</h1>
      {failed && <ErrorBanner message={t('signIn.failed')} />}
      <label htmlFor="email">{t('signIn.email')}</label>
      <input
        id="email" type="email" autoComplete="email" value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="password">{t('signIn.password')}</label>
      <input
        id="password" type="password" autoComplete="current-password" value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button
        disabled={busy}
        onClick={() => run(() => signInWithEmailAndPassword(auth, email, password))}
      >
        {t('signIn.submit')}
      </Button>
      <Button
        variant="secondary" disabled={busy}
        onClick={() => run(() => createUserWithEmailAndPassword(auth, email, password))}
      >
        {t('signIn.create')}
      </Button>
      <Button
        variant="secondary" disabled={busy}
        onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))}
      >
        {t('signIn.google')}
      </Button>
    </main>
  );
}
