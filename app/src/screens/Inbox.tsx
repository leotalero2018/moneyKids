import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { Card } from '../components/Card.js';
import { Money } from '../components/Money.js';
import { Spinner } from '../components/Spinner.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import type { InvoiceDoc } from '../lib/invoiceActions.js';
import styles from './Kids.module.css';

interface Kid { id: string; name: string }

/** Pending count for the tab badge; shares the query, so no extra reads. */
export function usePendingCount(): number {
  const { familyId } = useSession();
  const pending = useCollection<InvoiceDoc>(
    familyId
      ? query(collection(db, `families/${familyId}/invoices`), where('status', '==', 'sent'))
      : null,
  );
  return pending.docs.length;
}

export function Inbox() {
  const { t } = useTranslation();
  const { familyId } = useSession();
  const invoices = useCollection<InvoiceDoc>(
    familyId
      ? query(
          collection(db, `families/${familyId}/invoices`),
          where('status', '==', 'sent'),
          orderBy('createdAt', 'desc'),
        )
      : null,
  );
  const kids = useCollection<Kid>(familyId ? query(collection(db, `families/${familyId}/kids`)) : null);
  const nameFor = (kidId: string) => kids.docs.find((k) => k.id === kidId)?.name ?? kidId;

  if (invoices.loading) return <div className={styles.screen}><Spinner /></div>;
  if (invoices.error) return <div className={styles.screen}><ErrorBanner /></div>;

  return (
    <div className={styles.screen}>
      <h1>{t('inbox.title')}</h1>
      {invoices.docs.length === 0 && <p>{t('inbox.empty')}</p>}
      {invoices.docs.map((invoice) => (
        <Link key={invoice.id} to={`/invoice/${invoice.id}`} aria-label={nameFor(invoice.kidId)}>
          <Card label={`${nameFor(invoice.kidId)} ${invoice.id}`}>
            <strong>{nameFor(invoice.kidId)}</strong>
            <p>{invoice.description}</p>
            <p>{t('inbox.requested')}: <Money amount={invoice.requestedAmount} /></p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
