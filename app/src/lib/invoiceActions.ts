import { doc, serverTimestamp, writeBatch, type Timestamp } from 'firebase/firestore';
import type { DeductionLine } from '@money-kids/shared';
import type { FirebaseBundle } from '../firebase.js';

export interface InvoiceDoc {
  id: string;
  kidId: string;
  activityId: string | null;
  description: string;
  photoPaths: string[];
  status: 'draft' | 'sent' | 'approved' | 'countered' | 'returned';
  requestedAmount: number;
  eventCount: number;
  createdAt: Timestamp;
  counterOffer?: { amount: number; note?: string; parentId: string; at: Timestamp };
  approvedAmount?: number;
  netAmount?: number;
  deductions?: DeductionLine[];
}

const MAX_NOTE = 500;

/**
 * A transition and its event MUST be one batch: the invoice rule requires
 * existsAfter(events/e{newEventCount}) and the event rule validates `from`
 * against the pre-batch status. Writing either alone is denied.
 */
export async function returnInvoice(
  fb: FirebaseBundle, familyId: string, invoice: InvoiceDoc, note: string,
): Promise<void> {
  const { auth, db } = fb;
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not signed in');
  if (note.length > MAX_NOTE) throw new Error(`note must be at most ${MAX_NOTE} characters`);
  const nextCount = invoice.eventCount + 1;
  const batch = writeBatch(db);
  batch.update(doc(db, `families/${familyId}/invoices/${invoice.id}`), {
    status: 'returned', eventCount: nextCount,
  });
  batch.set(doc(db, `families/${familyId}/invoices/${invoice.id}/events/e${nextCount}`), {
    from: invoice.status, to: 'returned', actorUid: uid,
    at: serverTimestamp(), note, kidId: invoice.kidId,
  });
  await batch.commit();
}

export async function counterInvoice(
  fb: FirebaseBundle, familyId: string, invoice: InvoiceDoc, amount: number, note: string,
): Promise<void> {
  const { auth, db } = fb;
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not signed in');
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive integer in minor units');
  }
  if (note.length > MAX_NOTE) throw new Error(`note must be at most ${MAX_NOTE} characters`);
  const nextCount = invoice.eventCount + 1;
  const batch = writeBatch(db);
  batch.update(doc(db, `families/${familyId}/invoices/${invoice.id}`), {
    status: 'countered',
    eventCount: nextCount,
    // parentId and at are rule-checked against the caller and server time
    counterOffer: { amount, note, parentId: uid, at: serverTimestamp() },
  });
  batch.set(doc(db, `families/${familyId}/invoices/${invoice.id}/events/e${nextCount}`), {
    from: invoice.status, to: 'countered', actorUid: uid,
    at: serverTimestamp(), note, kidId: invoice.kidId,
  });
  await batch.commit();
}
