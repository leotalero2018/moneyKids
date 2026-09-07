import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { parseMajor } from '@money-kids/shared';
import { auth, db } from '../firebase.js';
import { useFirebase } from '../firebase/FirebaseContext.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { seedCatalog, type Pillar } from '../lib/catalog.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Money } from '../components/Money.js';
import { PillarIcon } from '../components/PillarIcon.js';
import { Spinner } from '../components/Spinner.js';
import styles from './Kids.module.css';

const PILLARS: Pillar[] = ['learn', 'courage', 'ideas', 'help'];

interface Activity {
  id: string;
  titleEs: string; titleEn: string;
  descriptionEs: string; descriptionEn: string;
  suggestedPrice: number; category: Pillar;
  repeatable: boolean; active: boolean;
}

export function Activities() {
  const { t, i18n } = useTranslation();
  const fb = useFirebase();
  const { familyId, family } = useSession();
  const activities = useCollection<Activity>(
    familyId ? query(collection(db, `families/${familyId}/activities`)) : null,
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<Pillar>('learn');
  const [repeatable, setRepeatable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isEs = i18n.language === 'es';

  async function create() {
    // the render guard below cannot narrow inside this closure, and a price
    // parsed against an unknown currency is exactly the 100x bug to avoid
    if (!familyId || !family) return;
    if (title.trim().length === 0 || title.trim().length > 80) {
      setError(t('activities.tooLong'));
      return;
    }
    let minor: number;
    try {
      // grouping separators are stripped here; parseMajor is deliberately strict
      minor = parseMajor(price.replace(/[^\d.,]/g, ''), family.currency);
    } catch {
      setError(t('activities.badPrice'));
      return;
    }
    setError(null);
    const uid = auth.currentUser!.uid;
    await setDoc(doc(collection(db, `families/${familyId}/activities`)), {
      titleEs: title.trim(), titleEn: title.trim(),
      descriptionEs: description.trim(), descriptionEn: description.trim(),
      suggestedPrice: minor, category, repeatable, active: true,
      createdBy: uid, createdAt: serverTimestamp(),
    });
    setTitle('');
    setDescription('');
    setPrice('');
  }

  async function setActive(activity: Activity, active: boolean) {
    // a partial update is fine: the rules see the merged document, and the
    // untouched createdBy/createdAt satisfy their immutability checks
    try {
      await updateDoc(doc(db, `families/${familyId}/activities/${activity.id}`), { active });
    } catch {
      setError(t('common.error'));
    }
  }

  // every price on this screen is scaled by the family currency, so nothing
  // may render — let alone be written — before the family has loaded
  if (!familyId || !family) return <div className={styles.screen}><Spinner /></div>;

  return (
    <div className={styles.screen}>
      <h1>{t('activities.title')}</h1>
      {error && <ErrorBanner message={error} />}

      {activities.docs.length === 0 && (
        <Button
          onClick={async () => {
            // awaited, not floating: a rejected seed used to vanish silently
            try {
              await seedCatalog(fb, familyId, family.currency, auth.currentUser!.uid);
            } catch {
              setError(t('common.error'));
            }
          }}
        >
          {t('activities.seed')}
        </Button>
      )}

      <Card label={t('activities.create')}>
        <label htmlFor="act-title">{t('activities.titleField')}</label>
        <input id="act-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="act-desc">{t('activities.description')}</label>
        <input id="act-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        <label htmlFor="act-price">{t('activities.price')}</label>
        <input id="act-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <label htmlFor="act-cat">{t('activities.category')}</label>
        <select
          id="act-cat" value={category}
          onChange={(e) => setCategory(e.target.value as Pillar)}
        >
          {PILLARS.map((p) => <option key={p} value={p}>{t(`activities.pillars.${p}`)}</option>)}
        </select>
        <label>
          <input
            type="checkbox" checked={repeatable}
            onChange={(e) => setRepeatable(e.target.checked)}
          />
          {t('activities.repeatable')}
        </label>
        <Button onClick={create}>{t('activities.create')}</Button>
      </Card>

      {PILLARS.map((pillar) => {
        const inPillar = activities.docs.filter((a) => a.category === pillar);
        if (inPillar.length === 0) return null;
        return (
          <section key={pillar}>
            <h2><PillarIcon pillar={pillar} /> {t(`activities.pillars.${pillar}`)}</h2>
            {inPillar.map((activity) => (
              <Card key={activity.id} label={isEs ? activity.titleEs : activity.titleEn}>
                <h3>{isEs ? activity.titleEs : activity.titleEn}</h3>
                <p>{isEs ? activity.descriptionEs : activity.descriptionEn}</p>
                <p><Money amount={activity.suggestedPrice} /></p>
                <label>
                  <input
                    type="checkbox" checked={activity.active}
                    onChange={(e) => setActive(activity, e.target.checked)}
                  />
                  {t('activities.active')}
                </label>
              </Card>
            ))}
          </section>
        );
      })}
    </div>
  );
}
