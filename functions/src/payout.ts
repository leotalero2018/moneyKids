import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { validateId, validateRequestId, validateNote, validateBalance } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

export async function recordPayoutCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: {
    familyId: string; kidId: string; balance: 'spendable' | 'savings';
    amount: number; note: string; requestId: string;
  },
): Promise<void> {
  // requestId is the highest-risk field here: it becomes part of the ledger
  // document ID, so an unvalidated value could target another ledger entry
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.kidId, 'kidId');
    validateRequestId(data.requestId);
    validateNote(data.note);
    validateBalance(data.balance);
  });
  await assertParentCaller(db, data.familyId, auth);
  if (!Number.isInteger(data.amount) || data.amount <= 0) {
    throw new HttpsError('invalid-argument', 'amount must be a positive integer');
  }
  await db.runTransaction(async (tx) => {
    const payoutRef = db.doc(`families/${data.familyId}/ledger/payout_${data.requestId}`);
    const existing = await tx.get(payoutRef);
    if (existing.exists) {
      // full audit payload must match, including the caller — otherwise a
      // different parent's retry would get a misleading success for someone
      // else's recorded payout
      const identical = existing.get('kidId') === data.kidId
        && existing.get('balance') === data.balance
        && existing.get('amount') === data.amount
        && existing.get('note') === data.note
        && existing.get('createdBy') === auth!.uid;
      if (identical) return; // idempotent retry: already recorded, no double debit
      throw new HttpsError('already-exists', 'requestId reused with mismatched payload');
    }
    const kidRef = db.doc(`families/${data.familyId}/kids/${data.kidId}`);
    const kid = await tx.get(kidRef);
    if (!kid.exists) throw new HttpsError('not-found', 'kid not found');
    const field = data.balance === 'spendable' ? 'spendableBalance' : 'savingsBalance';
    const current: number = kid.get(field) ?? 0;
    if (data.amount > current) {
      throw new HttpsError('failed-precondition', `payout exceeds ${data.balance} balance`);
    }
    tx.create(payoutRef, {
      kidId: data.kidId, type: 'payout', balance: data.balance, amount: data.amount,
      note: data.note, createdBy: auth!.uid, at: FieldValue.serverTimestamp(),
    });
    tx.update(kidRef, { [field]: FieldValue.increment(-data.amount) });
  });
}
