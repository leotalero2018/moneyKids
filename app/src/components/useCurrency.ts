import { useContext } from 'react';
import { SessionCtx } from '../session/SessionContext.js';
import { KidCtx } from '../kid/KidSessionContext.js';

/**
 * Money renders in both apps. Reading the contexts directly means both hooks
 * run unconditionally and a missing provider is a null, not a throw — no
 * try/catch around hooks, which would be a Rules-of-Hooks accident waiting
 * to happen.
 */
export function useCurrencyAndLocale(): { currency: string | null; locale: string } {
  const parent = useContext(SessionCtx);
  const kid = useContext(KidCtx);
  const family = parent?.family ?? kid?.family ?? null;
  return {
    currency: family?.currency ?? null,
    locale: (family?.language ?? 'es') === 'es' ? 'es-CO' : 'en-US',
  };
}
