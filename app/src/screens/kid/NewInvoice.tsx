import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { minorDigits, parseMajor } from '@money-kids/shared';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useKidSession } from '../../kid/KidSessionContext.js';
import { createDraft } from '../../lib/kidInvoice.js';
import { Button } from '../../components/Button.js';
import { Card } from '../../components/Card.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { Money } from '../../components/Money.js';
import { PillarIcon } from '../../components/PillarIcon.js';
import { Spinner } from '../../components/Spinner.js';
import { InvoicePhotos } from './InvoicePhotos.js';
import type { Pillar } from '../../lib/catalog.js';
import styles from './NewInvoice.module.css';

const PILLARS: Pillar[] = ['learn', 'courage', 'ideas', 'help'];
/** Fixed choices for the youngest mode, in whole major units. */
const PRICE_CHOICES = [1, 3, 5, 10];

export function NewInvoice() {
  const { t } = useTranslation();
  const fb = useFirebase();
  const { familyId, kidId, family, ageMode, status } = useKidSession();
  const [params] = useSearchParams();
  const activityId = params.get('activity');

  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [category, setCategory] = useState<Pillar | null>(null);
  const [chosenMinor, setChosenMinor] = useState<number | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // the one place age mode changes BEHAVIOR rather than tokens: at 5-8 the
  // kid does not type, so the photo carries the evidence and a tapped pillar
  // stands in for words
  const photoFirst = ageMode === '5-8';

  // prefill from the activity the kid tapped on the board
  useEffect(() => {
    if (!familyId || !activityId || !family) return;
    let live = true;
    void getDoc(doc(fb.db, `families/${familyId}/activities/${activityId}`)).then((snap) => {
      if (!live || !snap.exists()) return;
      const price = snap.get('suggestedPrice') as number;
      setPriceText(String(price / 10 ** minorDigits(family.currency)));
      setCategory(snap.get('category') as Pillar);
    });
    return () => { live = false; };
  }, [fb.db, familyId, activityId, family]);

  const choices = useMemo(
    () => (family ? PRICE_CHOICES.map((major) => major * 10 ** minorDigits(family.currency)) : []),
    [family],
  );

  async function save() {
    if (!familyId || !kidId || !family) return;
    setError(null);
    let amount: number;
    if (photoFirst) {
      if (chosenMinor === null) { setError(t('kidNew.badAmount')); return; }
      amount = chosenMinor;
    } else {
      try {
        amount = parseMajor(priceText.replace(/[^\d.,]/g, ''), family.currency);
      } catch {
        setError(t('kidNew.badAmount'));
        return;
      }
    }
    if (amount <= 0) { setError(t('kidNew.badAmount')); return; }

    const text = photoFirst
      ? (category ? t(`activities.pillars.${category}`) : '')
      : description.trim();
    if (text === '') { setError(t('kidNew.needDescription')); return; }

    setBusy(true);
    try {
      const id = await createDraft(fb, {
        familyId, kidId, activityId: activityId ?? null,
        description: text, requestedAmount: amount, category,
      });
      setInvoiceId(id); // photos need a server-side invoice to attach to
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  if (status !== 'ready' || !familyId || !kidId || !family) {
    return <div className={styles.screen}><Spinner /></div>;
  }

  return (
    <div className={styles.screen}>
      <h1>{t('kidNew.title')}</h1>
      {error && <ErrorBanner message={error} />}

      {invoiceId === null ? (
        <Card label={t('kidNew.title')}>
          {photoFirst ? (
            <>
              <p>{t('kidNew.pickCategory')}</p>
              <div className={styles.pillars}>
                {PILLARS.map((pillar) => (
                  <Button
                    key={pillar}
                    variant={category === pillar ? 'primary' : 'secondary'}
                    onClick={() => setCategory(pillar)}
                  >
                    <PillarIcon pillar={pillar} /> {t(`activities.pillars.${pillar}`)}
                  </Button>
                ))}
              </div>
              <p>{t('kidNew.pickPrice')}</p>
              <div className={styles.prices}>
                {choices.map((minor) => (
                  <Button
                    key={minor}
                    data-testid="price-choice"
                    variant={chosenMinor === minor ? 'primary' : 'secondary'}
                    onClick={() => setChosenMinor(minor)}
                  >
                    <Money amount={minor} />
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* the spec's free-form path is "picks category, writes
                  description, sets their own price" — so the picker is here
                  too, not only in the youngest mode. An invoice raised from
                  the board already knows its pillar. */}
              {!activityId && (
                <>
                  <p>{t('kidNew.pickCategory')}</p>
                  <div className={styles.pillars}>
                    {PILLARS.map((pillar) => (
                      <Button
                        key={pillar}
                        variant={category === pillar ? 'primary' : 'secondary'}
                        onClick={() => setCategory(pillar)}
                      >
                        <PillarIcon pillar={pillar} /> {t(`activities.pillars.${pillar}`)}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              <label htmlFor="inv-what">{t('kidNew.what')}</label>
              <small>{t('kidNew.whatHint')}</small>
              <textarea
                id="inv-what" value={description} maxLength={1000}
                onChange={(e) => setDescription(e.target.value)}
              />
              <label htmlFor="inv-price">{t('kidNew.howMuch')}</label>
              <input
                id="inv-price" inputMode="decimal" value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
              />
            </>
          )}
          <Button disabled={busy} onClick={save}>{t('kidNew.save')}</Button>
        </Card>
      ) : (
        <>
          <p role="status">{t('kidNew.saved')}</p>
          <InvoicePhotos familyId={familyId} kidId={kidId} invoiceId={invoiceId} />
        </>
      )}
    </div>
  );
}
