import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { collection, query, where } from 'firebase/firestore';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useCollection } from '../../hooks/useCollection.js';
import { useKidSession } from '../../kid/KidSessionContext.js';
import { Card } from '../../components/Card.js';
import { Money } from '../../components/Money.js';
import { PillarIcon } from '../../components/PillarIcon.js';
import { Spinner } from '../../components/Spinner.js';
import type { Pillar } from '../../lib/catalog.js';
import styles from './KidHome.module.css';

interface Activity {
  id: string;
  titleEs: string; titleEn: string;
  descriptionEs: string; descriptionEn: string;
  suggestedPrice: number; category: Pillar;
  repeatable: boolean; active: boolean;
}

export function KidHome() {
  const { t, i18n } = useTranslation();
  const { db } = useFirebase();
  const { familyId, kidId, kid, status } = useKidSession();
  const isEs = i18n.language === 'es';

  const activities = useCollection<Activity>(
    familyId
      ? query(collection(db, `families/${familyId}/activities`), where('active', '==', true))
      : null,
  );

  // the kid's own invoices, to hide one-time activities they have already had
  // approved. Reusing the kidId-constrained query needs no extra index, and a
  // kid's invoice list is small; a second (kidId, status) index would buy
  // nothing here. The approval function is still the real guard — this is the
  // courtesy the spec asks for, not an invariant.
  const mine = useCollection<{ activityId: string | null; status: string }>(
    familyId && kidId
      ? query(collection(db, `families/${familyId}/invoices`), where('kidId', '==', kidId))
      : null,
  );
  const usedOneTime = new Set(
    mine.docs.filter((i) => i.status === 'approved' && i.activityId).map((i) => i.activityId!),
  );

  if (status !== 'ready' || !kid) return <div className={styles.screen}><Spinner /></div>;

  const offered = activities.docs.filter(
    (activity) => activity.repeatable || !usedOneTime.has(activity.id),
  );

  return (
    <div className={styles.screen}>
      <h1>{t('kidHome.greeting', { name: kid.name })}</h1>

      <div className={styles.balances}>
        <p className={styles.label}>{t('kidHome.spendable')}</p>
        <p className={styles.big} data-testid="spendable">
          <Money amount={kid.spendableBalance} />
        </p>
        {kid.deductionsEnabled && (
          <>
            <p className={styles.label}>{t('kidHome.savings')}</p>
            <p className={styles.medium} data-testid="savings">
              <Money amount={kid.savingsBalance} />
            </p>
          </>
        )}
      </div>

      <h2>{t('kidHome.waysToEarn')}</h2>
      <Link to="/kid/new" className={styles.freeForm}>{t('kidHome.freeForm')}</Link>

      {activities.loading && <Spinner />}
      {!activities.loading && offered.length === 0 && <p>{t('kidHome.empty')}</p>}
      {offered.map((activity) => (
        <Link
          key={activity.id}
          to={`/kid/new?activity=${activity.id}`}
          aria-label={isEs ? activity.titleEs : activity.titleEn}
        >
          <Card label={isEs ? activity.titleEs : activity.titleEn}>
            <h3>
              <PillarIcon pillar={activity.category} />
              {' '}
              {isEs ? activity.titleEs : activity.titleEn}
            </h3>
            <p>{isEs ? activity.descriptionEs : activity.descriptionEn}</p>
            <p className={styles.medium}><Money amount={activity.suggestedPrice} /></p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
