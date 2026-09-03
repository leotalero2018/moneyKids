import { formatMinor } from '@money-kids/shared';
import { useSession } from '../session/SessionContext.js';

/** The single place minor units become text. Never format money inline. */
export function Money({ amount, currency }: { amount: number; currency?: string }) {
  const { family } = useSession();
  const code = currency ?? family?.currency ?? 'USD';
  const locale = (family?.language ?? 'es') === 'es' ? 'es-CO' : 'en-US';
  return <span>{formatMinor(amount, code, locale)}</span>;
}
