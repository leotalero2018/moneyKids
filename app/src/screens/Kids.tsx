import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, query, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { callables } from '../lib/callables.js';
import { useFirebase } from '../firebase/FirebaseContext.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Money } from '../components/Money.js';
import { Spinner } from '../components/Spinner.js';
import styles from './Kids.module.css';

interface Kid {
  id: string;
  name: string;
  birthYear: number;
  ageModeOverride?: '5-8' | '8-12' | '12-16' | null;
  deductionsEnabled: boolean;
  spendableBalance: number;
  savingsBalance: number;
}

export function Kids() {
  const { t } = useTranslation();
  const fb = useFirebase();
  const { familyId } = useSession();
  const kids = useCollection<Kid>(familyId ? query(collection(db, `families/${familyId}/kids`)) : null);
  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function addKid() {
    const year = Number(birthYear);
    const thisYear = new Date().getFullYear();
    if (name.trim() === '' || !Number.isInteger(year) || year < 2005 || year > thisYear) {
      setError(t('kids.invalidYear'));
      return;
    }
    setError(null);
    // balances must be exactly 0 on create — the rules reject anything else
    await setDoc(doc(collection(db, `families/${familyId}/kids`)), {
      name: name.trim(), birthYear: year, deductionsEnabled: false,
      spendableBalance: 0, savingsBalance: 0,
    });
    setName('');
    setBirthYear('');
  }

  async function showCode(kidId: string) {
    setError(null);
    try {
      const { data } = await callables(fb).createJoinCode({ familyId: familyId!, kidId });
      setCodes((prev) => ({ ...prev, [kidId]: data.code }));
    } catch {
      setError(t('common.error'));
    }
  }

  async function revoke(kidId: string) {
    setError(null);
    try {
      await callables(fb).revokeKidAccess({ familyId: familyId!, kidId });
      setCodes((prev) => {
        const next = { ...prev };
        delete next[kidId];
        return next;
      });
    } catch {
      setError(t('common.error'));
    }
  }

  return (
    <div className={styles.screen}>
      <h1>{t('kids.title')}</h1>
      {error && <ErrorBanner message={error} />}

      <Card label={t('kids.add')}>
        <label htmlFor="kid-name">{t('kids.name')}</label>
        <input id="kid-name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="kid-year">{t('kids.birthYear')}</label>
        <input
          id="kid-year" inputMode="numeric" value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
        />
        <Button onClick={addKid}>{t('kids.add')}</Button>
      </Card>

      {kids.loading && <Spinner />}
      {kids.docs.map((kid) => (
        <Card key={kid.id} label={kid.name}>
          <h2>{kid.name}</h2>
          <p>
            {t('money.spendable')}: <Money amount={kid.spendableBalance} />
            {' · '}
            {t('money.savings')}: <Money amount={kid.savingsBalance} />
          </p>
          <label>
            <input
              type="checkbox" checked={kid.deductionsEnabled}
              onChange={(e) => updateDoc(doc(db, `families/${familyId}/kids/${kid.id}`), {
                deductionsEnabled: e.target.checked,
              })}
            />
            {t('kids.deductions')}
          </label>
          <label htmlFor={`mode-${kid.id}`}>{t('kids.ageMode')}</label>
          <select
            id={`mode-${kid.id}`}
            value={kid.ageModeOverride ?? ''}
            onChange={(e) => updateDoc(doc(db, `families/${familyId}/kids/${kid.id}`), {
              // '' means "follow the birth year", stored as null so the field
              // is present and explicit rather than absent and ambiguous
              ageModeOverride: e.target.value === '' ? null : e.target.value,
            })}
          >
            <option value="">{t('kids.ageModeAuto')}</option>
            <option value="5-8">5–8</option>
            <option value="8-12">8–12</option>
            <option value="12-16">12–16</option>
          </select>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => showCode(kid.id)}>{t('kids.code')}</Button>
            <Button variant="danger" onClick={() => revoke(kid.id)}>{t('kids.revoke')}</Button>
          </div>
          {codes[kid.id] && (
            <p>
              <code data-testid="join-code">{codes[kid.id]}</code>
              <br />
              <small>{t('kids.codeHelp')}</small>
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
