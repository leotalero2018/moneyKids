import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { collection, orderBy, query } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { parseMajor } from '@money-kids/shared';
import { db, storage } from '../firebase.js';
import { useDoc } from '../hooks/useDoc.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { approveInvoice } from '../lib/callables.js';
import { counterInvoice, returnInvoice, type InvoiceDoc } from '../lib/invoiceActions.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Money } from '../components/Money.js';
import { Spinner } from '../components/Spinner.js';
import styles from './InvoiceDetail.module.css';

interface EventDoc {
  id: string;
  from: string;
  to: string;
  actorUid: string;
  note?: string;
  requestedAmount?: number;
}

export function InvoiceDetail() {
  const { t } = useTranslation();
  const { invoiceId } = useParams();
  const { familyId, family } = useSession();
  const invoice = useDoc<InvoiceDoc>(
    familyId && invoiceId ? `families/${familyId}/invoices/${invoiceId}` : null,
  );
  const events = useCollection<EventDoc>(
    familyId && invoiceId
      ? query(collection(db, `families/${familyId}/invoices/${invoiceId}/events`), orderBy('at', 'asc'))
      : null,
  );
  const [note, setNote] = useState('');
  const [counterText, setCounterText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  const data = invoice.data;
  const photoPaths = data?.photoPaths;

  useEffect(() => {
    if (!photoPaths?.length) {
      setPhotoUrls([]);
      return;
    }
    let live = true;
    void Promise.all(photoPaths.map((p) => getDownloadURL(ref(storage, p)).catch(() => null)))
      .then((urls) => {
        if (live) setPhotoUrls(urls.filter((u): u is string => u !== null));
      });
    return () => { live = false; };
  }, [photoPaths]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message || t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  if (invoice.loading || !family || !familyId) {
    return <div className={styles.screen}><Spinner /></div>;
  }
  if (invoice.error || !data) return <div className={styles.screen}><ErrorBanner /></div>;

  const isPending = data.status === 'sent';

  return (
    <div className={styles.screen}>
      <h1>{data.description}</h1>
      <p className={styles.amount}>
        {t('inbox.requested')}: <Money amount={data.requestedAmount} />
      </p>
      {error && <ErrorBanner message={error} />}

      {photoUrls.length > 0 && (
        <Card label={t('inbox.photos')}>
          <div className={styles.photos}>
            {photoUrls.map((url) => <img key={url} src={url} alt="" />)}
          </div>
        </Card>
      )}

      {data.status === 'approved' && data.deductions && (
        <Card label={t('review.gross')}>
          <p>{t('review.gross')}: <Money amount={data.approvedAmount ?? 0} /></p>
          <ul>
            {data.deductions.map((line) => (
              <li key={line.nameEn}>
                {family.language === 'en' ? line.nameEn : line.nameEs}
                {' −'}<Money amount={line.amount} />
              </li>
            ))}
          </ul>
          <p><strong>{t('review.net')}: <Money amount={data.netAmount ?? 0} /></strong></p>
        </Card>
      )}

      {isPending && (
        <Card label={t('review.approve')}>
          <Button
            disabled={busy}
            onClick={() => run(() => approveInvoice({ familyId, invoiceId: data.id }))}
          >
            {t('review.approve')}
          </Button>

          <label htmlFor="review-note">{t('review.note')}</label>
          <textarea
            id="review-note" value={note} maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            variant="secondary" disabled={busy}
            onClick={() => run(() => returnInvoice(familyId, data, note))}
          >
            {t('review.return')}
          </Button>

          <label htmlFor="counter-amount">{t('review.counterAmount')}</label>
          <input
            id="counter-amount" inputMode="decimal" value={counterText}
            onChange={(e) => setCounterText(e.target.value)}
          />
          <Button
            variant="secondary" disabled={busy}
            onClick={() => run(async () => {
              let minor: number;
              try {
                minor = parseMajor(counterText.replace(/[^\d.,]/g, ''), family.currency);
              } catch {
                throw new Error(t('review.badAmount'));
              }
              await counterInvoice(familyId, data, minor, note);
            })}
          >
            {t('review.counter')}
          </Button>
        </Card>
      )}

      <Card label={t('inbox.history')}>
        <h2>{t('inbox.history')}</h2>
        <ol>
          {events.docs.map((event) => (
            <li key={event.id}>
              {event.from} → {event.to}
              {event.requestedAmount !== undefined && <> (<Money amount={event.requestedAmount} />)</>}
              {event.note ? ` — ${event.note}` : ''}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
