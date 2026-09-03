import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { parseMajor } from '@money-kids/shared';
import { db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { recordPayout } from '../lib/callables.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Money } from '../components/Money.js';
import { Spinner } from '../components/Spinner.js';
import styles from './Kids.module.css';

interface Kid {
  id: string; name: string;
  spendableBalance: number; savingsBalance: number;
}

interface LedgerEntry {
  id: string; kidId: string;
  type: 'credit' | 'savings-credit' | 'payout';
  balance: 'spendable' | 'savings';
  amount: number; note?: string;
}

function KidPayout({ familyId, currency, kid }: { familyId: string; currency: string; kid: Kid }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<'spendable' | 'savings'>('spendable');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // held across retries: the callable is idempotent per requestId, so reusing
  // it makes a retry safe while a fresh one would pay twice
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const history = useCollection<LedgerEntry>(
    query(
      collection(db, `families/${familyId}/ledger`),
      where('kidId', '==', kid.id),
      orderBy('at', 'desc'),
      limit(10),
    ),
  );

  async function pay() {
    let minor: number;
    try {
      minor = parseMajor(amount.replace(/[^\d.,]/g, ''), currency);
    } catch {
      setError(t('payouts.badAmount'));
      return;
    }
    if (minor <= 0) {
      setError(t('payouts.badAmount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordPayout({ familyId, kidId: kid.id, balance, amount: minor, note, requestId });
      setAmount('');
      setNote('');
      setRequestId(crypto.randomUUID()); // only after a confirmed success
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card label={kid.name}>
      <h2>{kid.name}</h2>
      <p>
        {t('money.spendable')}: <Money amount={kid.spendableBalance} />
        {' · '}
        {t('money.savings')}: <Money amount={kid.savingsBalance} />
      </p>
      {error && <ErrorBanner message={error} />}

      <label htmlFor={`from-${kid.id}`}>{t('payouts.from')}</label>
      <select
        id={`from-${kid.id}`} value={balance}
        onChange={(e) => setBalance(e.target.value as 'spendable' | 'savings')}
      >
        <option value="spendable">{t('money.spendable')}</option>
        <option value="savings">{t('money.savings')}</option>
      </select>

      <label htmlFor={`amount-${kid.id}`}>{t('payouts.amount')}</label>
      <input
        id={`amount-${kid.id}`} inputMode="decimal" value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <label htmlFor={`note-${kid.id}`}>{t('payouts.note')}</label>
      <input
        id={`note-${kid.id}`} value={note} maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />

      <Button disabled={busy} onClick={pay}>{t('payouts.submit')}</Button>

      <h3>{t('payouts.history')}</h3>
      <ul>
        {history.docs.map((entry) => (
          <li key={entry.id}>
            {t(`payouts.types.${entry.type}`)}{' '}
            {entry.type === 'payout' ? '−' : '+'}
            <Money amount={entry.amount} />
            {entry.note ? ` — ${entry.note}` : ''}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Payouts() {
  const { t } = useTranslation();
  const { familyId, family } = useSession();
  const kids = useCollection<Kid>(familyId ? query(collection(db, `families/${familyId}/kids`)) : null);

  // amounts are parsed and displayed against the family currency
  if (!familyId || !family) return <div className={styles.screen}><Spinner /></div>;

  return (
    <div className={styles.screen}>
      <h1>{t('payouts.title')}</h1>
      {kids.docs.map((kid) => (
        <KidPayout key={kid.id} familyId={familyId} currency={family.currency} kid={kid} />
      ))}
    </div>
  );
}
