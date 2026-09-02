import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { validateDeductionRules, validateId, type DeductionRule } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

export async function setDeductionRulesCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string; rules: DeductionRule[] },
): Promise<void> {
  checked(() => validateId(data.familyId, 'familyId'));
  await assertParentCaller(db, data.familyId, auth);
  try {
    validateDeductionRules(data.rules);
  } catch (e) {
    throw new HttpsError('invalid-argument', (e as Error).message);
  }
  await db.doc(`families/${data.familyId}`).update({ deductionRules: data.rules });
}
