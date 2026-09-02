import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { validateId } from '@money-kids/shared';
import { approveInTransaction } from './approval.js';
import { checked, assertKidCaller, type CallerAuth } from './auth.js';

export async function acceptCounterOfferCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string; invoiceId: string },
): Promise<{ approvedAmount: number; netAmount: number }> {
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.invoiceId, 'invoiceId');
  });
  const kidId = assertKidCaller(data.familyId, auth);
  const inv = await db.doc(`families/${data.familyId}/invoices/${data.invoiceId}`).get();
  if (!inv.exists) throw new HttpsError('not-found', 'invoice not found');
  if (inv.get('kidId') !== kidId) throw new HttpsError('permission-denied', 'not your invoice');
  const counterAmount: number | undefined = inv.get('counterOffer')?.amount;
  if (!counterAmount) throw new HttpsError('failed-precondition', 'no counter-offer to accept');
  return approveInTransaction(db, data.familyId, data.invoiceId, {
    gross: counterAmount,
    actorUid: auth!.uid,
    expectedStatus: 'countered',
  });
}
