import { formatMinor } from '@money-kids/shared';
import { useCurrencyAndLocale } from './useCurrency.js';

/**
 * The single place minor units become text. Never format money inline.
 *
 * If the family currency is not known yet, render NOTHING rather than falling
 * back to a default: 7000 COP formatted as USD reads "US$ 70,00", and showing
 * a wrong amount — even for one frame — is worse than showing none.
 */
export function Money({ amount, currency }: { amount: number; currency?: string }) {
  const resolved = useCurrencyAndLocale();
  const code = currency ?? resolved.currency;
  if (!code) return null;
  return <span>{formatMinor(amount, code, resolved.locale)}</span>;
}
