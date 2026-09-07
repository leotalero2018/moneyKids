import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { SUPPORTED_CURRENCIES } from '@money-kids/shared';
import { auth, db } from '../firebase.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import type { Language } from '../i18n/index.js';
import styles from './SignIn.module.css';

// the currency list comes from the shared minor-unit table: offering a
// currency the math cannot scale would break every amount in that family
export { SUPPORTED_CURRENCIES };

export function CreateFamily() {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>((i18n.language as Language) ?? 'es');
  const [currency, setCurrency] = useState<string>('COP');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (name.trim() === '') {
      setError(t('createFamily.nameRequired'));
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      // one batch: the rules reject a family without its founder member doc,
      // and parentIndex requires that member doc to exist after the write
      const familyRef = doc(collection(db, 'families'));
      const batch = writeBatch(db);
      batch.set(familyRef, {
        name: name.trim(), language, currency, createdBy: uid, deductionRules: [],
      });
      batch.set(doc(db, `families/${familyRef.id}/members`, uid), {
        role: 'parent',
        displayName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? 'Parent',
      });
      batch.set(doc(db, 'parentIndex', uid), { familyId: familyRef.id });
      await batch.commit();
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <h1>{t('createFamily.title')}</h1>
      {error && <ErrorBanner message={error} />}
      <label htmlFor="fam-name">{t('createFamily.name')}</label>
      <input id="fam-name" value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="fam-language">{t('createFamily.language')}</label>
      <select
        id="fam-language" value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
      >
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>

      <label htmlFor="fam-currency">{t('createFamily.currency')}</label>
      <select id="fam-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <p>{t('createFamily.permanent')}</p>

      <Button disabled={busy} onClick={create}>{t('createFamily.submit')}</Button>
      <Link to="/join">{t('joinParent.title')}</Link>
    </main>
  );
}
