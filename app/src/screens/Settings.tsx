import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { createParentInvite } from '../lib/callables.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import styles from './Kids.module.css';

interface InviteLogEntry { id: string; createdBy: string; usedBy: string | null }

export function Settings() {
  const { t, i18n } = useTranslation();
  const { familyId } = useSession();
  const invites = useCollection<InviteLogEntry>(
    familyId ? query(collection(db, `families/${familyId}/inviteLog`)) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      await createParentInvite({ familyId: familyId! });
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <h1>{t('settings.title')}</h1>
      {error && <ErrorBanner message={error} />}

      <Card label={t('settings.invites')}>
        <h2>{t('settings.invites')}</h2>
        <p><small>{t('settings.inviteHelp')}</small></p>
        <Button disabled={busy} onClick={invite}>{t('settings.createInvite')}</Button>
        <ul>
          {invites.docs.map((entry) => (
            <li key={entry.id}>
              <code>{entry.id}</code>{' — '}
              {entry.usedBy ? `${t('settings.inviteUsedBy')} ${entry.usedBy}` : t('settings.inviteUnused')}
            </li>
          ))}
        </ul>
      </Card>

      <Card label={t('settings.language')}>
        <h2>{t('settings.language')}</h2>
        <select
          aria-label={t('settings.language')} value={i18n.language}
          onChange={(e) => i18n.changeLanguage(e.target.value)}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </Card>
    </div>
  );
}
