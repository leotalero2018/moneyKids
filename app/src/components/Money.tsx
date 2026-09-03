import { formatMinor } from '@money-kids/shared';
import { useSession } from '../session/SessionContext.js';

/**
 * The single place minor units become text. Never format money inline.
 *
 * If the family currency is not known yet, this renders nothing rather than
 * falling back to a default: COP 7.000 formatted as USD reads "US$ 70,00",
 * and showing a wrong amount — even for one frame — is worse than showing
 * none. Screens under ParentShell always have a loaded family.
 */
export function Money({ amount, currency }: { amount: number; currency?: string }) {
  const { family } = useSession();
  const code = currency ?? family?.currency;
  if (!code) return null;
  const locale = (family?.language ?? 'es') === 'es' ? 'es-CO' : 'en-US';
  return <span>{formatMinor(amount, code, locale)}</span>;
}
