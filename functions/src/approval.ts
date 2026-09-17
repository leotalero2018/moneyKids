import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import {
  canTransition,
  computeDeductions,
  validateId,
  type DeductionRule,
  type InvoiceStatus,
} from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

export async function approveInTransaction(
  db: Firestore,
  familyId: string,
  invoiceId: string,
  opts: { gross: number; actorUid: string; expectedStatus: 'sent' | 'countered' },
): Promise<{ approvedAmount: number; netAmount: number }> {
  return db.runTransaction(async (tx) => {
    const famRef = db.doc(`families/${familyId}`);
    const invRef = famRef.collection('invoices').doc(invoiceId);
    const inv = await tx.get(invRef);
    if (!inv.exists) throw new HttpsError('not-found', 'invoice not found');
    const data = inv.data()!;
    const from = data.status as InvoiceStatus;
    // Callables bypass Firestore rules entirely and are the only path that
    // credits a balance, so the transition rule they enforce has to be the
    // shared one rather than a second copy that can drift from it.
    //
    // Today this is strictly wider than the narrowing check below — both
    // server transitions are legal, so nothing reaches here that only this
    // rejects. What it buys is that REMOVING a transition from the table takes
    // effect in the callable with no code edit, which is what the conformance
    // test pins.
    if (!canTransition(from, 'approved', 'server')) {
      throw new HttpsError('failed-precondition', `cannot approve from status ${from}`);
    }
    // Each entry point also stays narrow: approveInvoice settles a sent
    // invoice, acceptCounterOffer a countered one. Without this, approveInvoice
    // would settle a countered invoice at the amount the kid originally asked
    // for, ignoring the parent's counter-offer.
    if (from !== opts.expectedStatus) {
      throw new HttpsError(
        'failed-precondition',
        `this action cannot settle an invoice in status ${from}`,
      );
    }
    const kidRef = famRef.collection('kids').doc(data.kidId);
    const [kid, family] = [await tx.get(kidRef), await tx.get(famRef)];
    if (!kid.exists) throw new HttpsError('not-found', 'kid not found');

    if (data.activityId) {
      const activity = await tx.get(famRef.collection('activities').doc(data.activityId));
      if (activity.exists && activity.get('repeatable') === false) {
        const dup = await tx.get(
          famRef.collection('invoices')
            .where('kidId', '==', data.kidId)
            .where('activityId', '==', data.activityId)
            .where('status', '==', 'approved')
            .limit(1),
        );
        if (!dup.empty) {
          throw new HttpsError('failed-precondition', 'one-time activity already approved for this kid');
        }
      }
    }

    const rules: DeductionRule[] = kid.get('deductionsEnabled')
      ? (family.get('deductionRules') ?? [])
      : [];
    const breakdown = computeDeductions(opts.gross, rules);

    const nextEventCount = (data.eventCount ?? 0) + 1;
    tx.update(invRef, {
      status: 'approved',
      approvedAmount: breakdown.gross,
      deductions: breakdown.lines,
      netAmount: breakdown.netAmount,
      eventCount: nextEventCount,
    });
    tx.create(invRef.collection('events').doc(`e${nextEventCount}`), {
      from, to: 'approved', actorUid: opts.actorUid,
      at: FieldValue.serverTimestamp(), kidId: data.kidId,
    });
    if (breakdown.netAmount > 0) {
      tx.create(famRef.collection('ledger').doc(`credit_${invoiceId}`), {
        kidId: data.kidId, type: 'credit', balance: 'spendable', amount: breakdown.netAmount,
        invoiceId, createdBy: opts.actorUid, at: FieldValue.serverTimestamp(),
      });
    }
    if (breakdown.savingsTotal > 0) {
      tx.create(famRef.collection('ledger').doc(`savings_${invoiceId}`), {
        kidId: data.kidId, type: 'savings-credit', balance: 'savings', amount: breakdown.savingsTotal,
        invoiceId, createdBy: opts.actorUid, at: FieldValue.serverTimestamp(),
      });
    }
    tx.update(kidRef, {
      spendableBalance: FieldValue.increment(breakdown.netAmount),
      savingsBalance: FieldValue.increment(breakdown.savingsTotal),
    });
    return { approvedAmount: breakdown.gross, netAmount: breakdown.netAmount };
  });
}

export async function approveInvoiceCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string; invoiceId: string },
): Promise<{ approvedAmount: number; netAmount: number }> {
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.invoiceId, 'invoiceId');
  });
  await assertParentCaller(db, data.familyId, auth);
  const inv = await db.doc(`families/${data.familyId}/invoices/${data.invoiceId}`).get();
  if (!inv.exists) throw new HttpsError('not-found', 'invoice not found');
  return approveInTransaction(db, data.familyId, data.invoiceId, {
    gross: inv.get('requestedAmount'),
    actorUid: auth!.uid,
    expectedStatus: 'sent',
  });
}
