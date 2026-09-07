import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { formatMinor } from '@money-kids/shared';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useDoc } from '../../hooks/useDoc.js';
import { useKidSession } from '../../kid/KidSessionContext.js';
import { callables } from '../../lib/callables.js';
import { sendInvoice, updateDraft } from '../../lib/kidInvoice.js';
import { Button } from '../../components/Button.js';
import { Card } from '../../components/Card.js';
import { Celebrate } from '../../components/Celebrate.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { Money } from '../../components/Money.js';
import { Spinner } from '../../components/Spinner.js';
import type { InvoiceDoc } from '../../lib/invoiceActions.js';
import styles from './NewInvoice.module.css';

const UNSENT = ['draft', 'returned', 'countered'];

export function InvoiceNegotiation() {
  const { t } = useTranslation();
  const { invoiceId } = useParams();
  const fb = useFirebase();
  const { familyId, family, status } = useKidSession();
  const invoice = useDoc<InvoiceDoc>(
    familyId && invoiceId ? `families/${familyId}/invoices/${invoiceId}` : null,
  );
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = invoice.data;
  const loadedId = data?.id;

  useEffect(() => { if (data) setText(data.description); }, [loadedId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  if (status !== 'ready' || !familyId || !family || invoice.loading) {
    return <div className={styles.screen}><Spinner /></div>;
  }
  if (invoice.error || !data) return <div className={styles.screen}><ErrorBanner /></div>;

  const counter = data.counterOffer;

  return (
    <div className={styles.screen}>
      <h1>{t('kidNegotiation.title')}</h1>
      {error && <ErrorBanner message={error} />}
      {data.status === 'approved' && <Celebrate />}

      <Card label={t('kidNegotiation.title')}>
        <p data-testid="asked">
          {t('kidNegotiation.asked')}: <Money amount={data.requestedAmount} />
        </p>
        {counter && (
          <>
            <p data-testid="offered">
              {t('kidNegotiation.offered')}: <Money amount={counter.amount} />
            </p>
            {counter.note ? <p>{counter.note}</p> : null}
          </>
        )}
      </Card>

      {/* draft and returned both need edit-and-send; only countered offers
          an amount to accept */}
      {UNSENT.includes(data.status) && (
        <>
          {data.status === 'countered' && counter && (
            <Button
              disabled={busy}
              onClick={() => run(() => callables(fb).acceptCounterOffer({
                familyId, invoiceId: data.id,
              }))}
            >
              {t('kidNegotiation.accept', {
                amount: formatMinor(
                  counter.amount, family.currency,
                  family.language === 'es' ? 'es-CO' : 'en-US',
                ),
              })}
            </Button>
          )}

          <label htmlFor="neg-text">{t('kidNegotiation.explain')}</label>
          <textarea
            id="neg-text" value={text} maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            variant="secondary" disabled={busy}
            onClick={() => run(async () => {
              // save the better explanation first, then resend at the SAME
              // price: the point of countering back is the argument, not a
              // silent discount
              await updateDraft(fb, {
                familyId, invoiceId: data.id, status: data.status,
                fields: { description: text.trim() },
              });
              await sendInvoice(fb, {
                familyId,
                invoice: { ...data, description: text.trim() },
              });
            })}
          >
            {t('kidNegotiation.resend')}
          </Button>
        </>
      )}
    </div>
  );
}
