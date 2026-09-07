import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateDeductionRules, type DeductionRule, type Destination } from '@money-kids/shared';
import { useSession } from '../session/SessionContext.js';
import { callables } from '../lib/callables.js';
import { useFirebase } from '../firebase/FirebaseContext.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Spinner } from '../components/Spinner.js';

const STARTER_PRESET: DeductionRule[] = [
  { nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' },
  { nameEs: 'Impuesto familiar', nameEn: 'Family tax', basisPoints: 1000, destination: 'withheld' },
];

/** '7.5' -> 750 basis points. Percent input, basis-point storage. */
function percentToBasisPoints(text: string): number {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text.trim())) throw new Error('bad percent');
  const bp = Math.round(Number(text.trim()) * 100);
  if (bp < 0 || bp > 10000) throw new Error('bad percent');
  return bp;
}

export function DeductionSettings() {
  const { t } = useTranslation();
  const fb = useFirebase();
  const { familyId, family } = useSession();
  const rules = family?.deductionRules ?? [];
  const [nameEs, setNameEs] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [percent, setPercent] = useState('');
  const [destination, setDestination] = useState<Destination>('savings');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: DeductionRule[]) {
    if (!familyId) return;
    setBusy(true);
    setError(null);
    try {
      // the same validator the callable runs, so the parent sees the problem
      // without a round trip; the server still re-validates
      validateDeductionRules(next);
      await callables(fb).setDeductionRules({ familyId, rules: next });
    } catch (e) {
      setError(/sum|exceed/i.test((e as Error).message) ? t('deductions.tooMuch') : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    let basisPoints: number;
    try {
      basisPoints = percentToBasisPoints(percent);
    } catch {
      setError(t('deductions.badPercent'));
      return;
    }
    if (nameEs.trim() === '' || nameEn.trim() === '') {
      setError(t('common.error'));
      return;
    }
    const next = [...rules, {
      nameEs: nameEs.trim(), nameEn: nameEn.trim(), basisPoints, destination,
    }];
    const total = next.reduce((sum, r) => sum + r.basisPoints, 0);
    if (total > 10000) {
      setError(t('deductions.tooMuch'));
      return;
    }
    await save(next);
    setNameEs('');
    setNameEn('');
    setPercent('');
  }

  // nothing here may render before the session resolves: the rule list comes
  // from the family document, and a save with no familyId silently no-ops,
  // which looks exactly like a button that does nothing
  if (!familyId || !family) return <Spinner />;

  return (
    <Card label={t('deductions.title')}>
      <h2>{t('deductions.title')}</h2>
      <p><small>{t('deductions.help')}</small></p>
      {error && <ErrorBanner message={error} />}

      {rules.length === 0 && (
        <>
          <p>{t('deductions.off')}</p>
          <Button disabled={busy} onClick={() => save(STARTER_PRESET)}>
            {t('deductions.preset')}
          </Button>
        </>
      )}

      <ul>
        {rules.map((rule, index) => (
          <li key={`${rule.nameEn}-${rule.basisPoints}`}>
            {rule.nameEs} / {rule.nameEn} — {(rule.basisPoints / 100).toFixed(2)}%
            {' · '}
            {rule.destination === 'savings' ? t('deductions.toSavings') : t('deductions.withheld')}
            {' '}
            <Button
              variant="danger" disabled={busy}
              onClick={() => save(rules.filter((_, i) => i !== index))}
            >
              {t('deductions.remove')}
            </Button>
          </li>
        ))}
      </ul>

      <label htmlFor="ded-es">{t('deductions.nameEs')}</label>
      <input id="ded-es" value={nameEs} maxLength={60} onChange={(e) => setNameEs(e.target.value)} />
      <label htmlFor="ded-en">{t('deductions.nameEn')}</label>
      <input id="ded-en" value={nameEn} maxLength={60} onChange={(e) => setNameEn(e.target.value)} />
      <label htmlFor="ded-pct">{t('deductions.percent')}</label>
      <input
        id="ded-pct" inputMode="decimal" value={percent}
        onChange={(e) => setPercent(e.target.value)}
      />
      <label htmlFor="ded-dest">{t('deductions.destination')}</label>
      <select
        id="ded-dest" value={destination}
        onChange={(e) => setDestination(e.target.value as Destination)}
      >
        <option value="savings">{t('deductions.toSavings')}</option>
        <option value="withheld">{t('deductions.withheld')}</option>
      </select>
      <Button disabled={busy} onClick={add}>{t('common.save')}</Button>
    </Card>
  );
}
