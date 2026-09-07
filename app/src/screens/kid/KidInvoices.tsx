import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useCollection } from '../../hooks/useCollection.js';
import { useKidSession } from '../../kid/KidSessionContext.js';
import { Card } from '../../components/Card.js';
import { Money } from '../../components/Money.js';
import { Spinner } from '../../components/Spinner.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import type { InvoiceDoc } from '../../lib/invoiceActions.js';
import styles from './KidInvoices.module.css';

const UNSENT = ['draft', 'returned', 'countered'];

export function KidInvoices() {
  const { t, i18n } = useTranslation();
  const { db } = useFirebase();
  const { familyId, kidId, ageMode, status } = useKidSession();

  // the rules do not filter queries: this MUST be constrained by kidId, or
  // the whole read is denied rather than trimmed
  const invoices = useCollection<InvoiceDoc>(
    familyId && kidId
      ? query(
          collection(db, `families/${familyId}/invoices`),
          where('kidId', '==', kidId),
          orderBy('createdAt', 'desc'),
        )
      : null,
  );

  if (status !== 'ready') return <div className={styles.screen}><Spinner /></div>;
  if (invoices.error) return <div className={styles.screen}><ErrorBanner /></div>;

  const approved = invoices.docs.filter((i) => i.status === 'approved');
  const approvedTotal = approved.reduce((sum, i) => sum + (i.approvedAmount ?? 0), 0);
  const isEs = i18n.language === 'es';

  return (
    <div className={styles.screen}>
      <h1>{t('kidInvoices.title')}</h1>

      {/* the spec puts earnings stats in the oldest mode only */}
      {ageMode === '12-16' && approved.length > 0 && (
        <Card label={t('kidInvoices.stats')}>
          <h2>{t('kidInvoices.stats')}</h2>
          <p data-testid="stats">
            {t('kidInvoices.statsApproved')}: <Money amount={approvedTotal} />
            {' · '}
            {t('kidInvoices.statsCount')}: {approved.length}
          </p>
        </Card>
      )}

      {invoices.loading && <Spinner />}
      {!invoices.loading && invoices.docs.length === 0 && <p>{t('kidInvoices.empty')}</p>}

      <ul className={styles.list}>
        {invoices.docs.map((invoice) => (
          <li key={invoice.id}>
            <Card label={invoice.description}>
              <p className={styles.status}>{t(`kidInvoices.statuses.${invoice.status}`)}</p>
              <h3>{invoice.description}</h3>
              <p><Money amount={invoice.requestedAmount} /></p>

              {invoice.status === 'approved' && invoice.deductions && (
                <div data-testid={`paystub-${invoice.id}`} className={styles.stub}>
                  <p>{t('kidInvoices.gross')}: <Money amount={invoice.approvedAmount ?? 0} /></p>
                  {invoice.deductions.map((line) => (
                    <p key={line.nameEn}>
                      {isEs ? line.nameEs : line.nameEn}
                      {' — '}
                      {line.destination === 'savings'
                        ? t('kidInvoices.toSavings')
                        : t('kidInvoices.withheld')}
                      {': −'}<Money amount={line.amount} />
                    </p>
                  ))}
                  <p><strong>
                    {t('kidInvoices.net')}: <Money amount={invoice.netAmount ?? 0} />
                  </strong></p>
                </div>
              )}

              {UNSENT.includes(invoice.status) && (
                <Link to={`/kid/invoice/${invoice.id}`}>{t('kidInvoices.open')}</Link>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
