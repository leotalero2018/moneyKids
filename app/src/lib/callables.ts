import { httpsCallable, type HttpsCallable } from 'firebase/functions';
import type { DeductionRule } from '@money-kids/shared';
import type { FirebaseBundle } from '../firebase.js';

/**
 * Every money mutation goes through here, on the caller's own instance — a
 * kid session must call with kid credentials, not the parent's.
 *
 * Typed with HttpsCallable rather than hand-written signatures plus a cast:
 * the SDK's own type already describes `(data) => Promise<{ data: Res }>`, and
 * a cast here would silently accept a wrong request shape.
 */
export interface Callables {
  createJoinCode: HttpsCallable<{ familyId: string; kidId: string }, { code: string }>;
  revokeKidAccess: HttpsCallable<{ familyId: string; kidId: string }, void>;
  approveInvoice: HttpsCallable<
    { familyId: string; invoiceId: string },
    { approvedAmount: number; netAmount: number }
  >;
  acceptCounterOffer: HttpsCallable<
    { familyId: string; invoiceId: string },
    { approvedAmount: number; netAmount: number }
  >;
  recordPayout: HttpsCallable<{
    familyId: string; kidId: string; balance: 'spendable' | 'savings';
    amount: number; note: string; requestId: string;
  }, void>;
  setDeductionRules: HttpsCallable<{ familyId: string; rules: DeductionRule[] }, void>;
  createParentInvite: HttpsCallable<{ familyId: string }, { code: string }>;
  acceptParentInvite: HttpsCallable<{ code: string }, { familyId: string }>;
  mintKidToken: HttpsCallable<{ code: string }, { token: string }>;
}

// memoized per bundle: httpsCallable allocates, and a component may call this
// on every render
const cache = new WeakMap<FirebaseBundle, Callables>();

export function callables(fb: FirebaseBundle): Callables {
  const hit = cache.get(fb);
  if (hit) return hit;
  const made: Callables = {
    createJoinCode: httpsCallable(fb.fns, 'createJoinCode'),
    revokeKidAccess: httpsCallable(fb.fns, 'revokeKidAccess'),
    approveInvoice: httpsCallable(fb.fns, 'approveInvoice'),
    acceptCounterOffer: httpsCallable(fb.fns, 'acceptCounterOffer'),
    recordPayout: httpsCallable(fb.fns, 'recordPayout'),
    setDeductionRules: httpsCallable(fb.fns, 'setDeductionRules'),
    createParentInvite: httpsCallable(fb.fns, 'createParentInvite'),
    acceptParentInvite: httpsCallable(fb.fns, 'acceptParentInvite'),
    mintKidToken: httpsCallable(fb.fns, 'mintKidToken'),
  };
  cache.set(fb, made);
  return made;
}
