import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  collection, doc, getDocFromServer, getDocsFromServer, writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { clearFirestoreData, seedDoc, signInTestParent } from '../test/emulator.js';
import { returnInvoice, counterInvoice, type InvoiceDoc } from './invoiceActions.js';

const familyId = 'famI';
let uid: string;

beforeAll(async () => { await signInTestParent('actionparent'); });

beforeEach(async () => {
  await clearFirestoreData();
  uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
  // a sent invoice with one prior event, as the kid would have left it —
  // seeded through the admin path since only a kid session may create one
  await seedDoc(`families/${familyId}/invoices/inv1`, {
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'sent', requestedAmount: 5000, eventCount: 1, createdAt: new Date(),
  });
});

async function loadInvoice(): Promise<InvoiceDoc> {
  const snap = await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1`));
  return { ...snap.data(), id: snap.id } as InvoiceDoc;
}

describe('returnInvoice', () => {
  it('transitions to returned and writes the paired event', async () => {
    await returnInvoice(familyId, await loadInvoice(), 'Cuéntame más');
    const snap = await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1`));
    expect(snap.get('status')).toBe('returned');
    expect(snap.get('eventCount')).toBe(2);
    const event = await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1/events/e2`));
    expect(event.get('from')).toBe('sent');
    expect(event.get('to')).toBe('returned');
    expect(event.get('actorUid')).toBe(uid);
    expect(event.get('note')).toBe('Cuéntame más');
    expect(event.get('kidId')).toBe('k1');
    // requestedAmount belongs only to -> sent events
    expect(event.get('requestedAmount')).toBeUndefined();
  });

  it('rejects a note longer than the rules allow, leaving the invoice untouched', async () => {
    await expect(returnInvoice(familyId, await loadInvoice(), 'x'.repeat(501))).rejects.toThrow();
    const snap = await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1`));
    expect(snap.get('status')).toBe('sent');
    expect((await getDocsFromServer(collection(db, `families/${familyId}/invoices/inv1/events`))).size)
      .toBe(0);
  });
});

describe('counterInvoice', () => {
  it('records the counter-offer with the acting parent and a server time', async () => {
    await counterInvoice(familyId, await loadInvoice(), 3000, 'Un poco menos');
    const snap = await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1`));
    expect(snap.get('status')).toBe('countered');
    expect(snap.get('counterOffer').amount).toBe(3000);
    expect(snap.get('counterOffer').parentId).toBe(uid);
    expect(snap.get('counterOffer').at).toBeTruthy();
    const event = await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1/events/e2`));
    expect(event.get('to')).toBe('countered');
  });

  it('refuses a non-positive or non-integer amount before writing', async () => {
    const invoice = await loadInvoice();
    await expect(counterInvoice(familyId, invoice, 0, '')).rejects.toThrow(/amount/i);
    await expect(counterInvoice(familyId, invoice, -100, '')).rejects.toThrow(/amount/i);
    await expect(counterInvoice(familyId, invoice, 12.5, '')).rejects.toThrow(/amount/i);
    expect((await loadInvoice()).status).toBe('sent');
  });

  it('cannot act on an invoice that is not sent', async () => {
    await counterInvoice(familyId, await loadInvoice(), 3000, '');
    // already countered: the rules only allow sent -> countered
    await expect(counterInvoice(familyId, await loadInvoice(), 2000, '')).rejects.toThrow();
  });
});
