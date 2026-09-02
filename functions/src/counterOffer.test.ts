import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { acceptCounterOfferCore } from './counterOffer.js';

let db: Firestore;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;
const siblingAuth = { uid: 'kid_fam1_k2', token: { role: 'kid', familyId: 'fam1', kidId: 'k2' } } as never;
const parentAuth = { uid: 'p1', token: {} } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({ name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
  await db.doc('families/fam1/invoices/inv1').set({
    kidId: 'k1', activityId: null, description: 'idea', photoPaths: [],
    status: 'countered', requestedAmount: 8000, eventCount: 2,
    counterOffer: { amount: 5000, note: 'menos', parentId: 'p1', at: Timestamp.now() },
  });
});

describe('acceptCounterOfferCore', () => {
  it('kid accepts: approved strictly at the counter amount, not the requested one', async () => {
    const result = await acceptCounterOfferCore(db, kidAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    expect(result.approvedAmount).toBe(5000);
    const inv = await db.doc('families/fam1/invoices/inv1').get();
    expect(inv.get('status')).toBe('approved');
    expect(inv.get('approvedAmount')).toBe(5000);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(5000);
  });
  it('rejects a sibling, a parent caller, and a non-countered invoice', async () => {
    await expect(acceptCounterOfferCore(db, siblingAuth, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow();
    await expect(acceptCounterOfferCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow();
    await db.doc('families/fam1/invoices/inv1').update({ status: 'sent' });
    await expect(acceptCounterOfferCore(db, kidAuth, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow(/cannot approve/i);
  });
  it('rejects a kid of another family holding a valid kid token', async () => {
    // claims are well-formed and role is 'kid', but for fam2 — the familyId in
    // the claim must match the target family, not merely be present
    const foreignKidAuth = { uid: 'kid_fam2_k9', token: { role: 'kid', familyId: 'fam2', kidId: 'k9' } } as never;
    await expect(acceptCounterOfferCore(db, foreignKidAuth, { familyId: 'fam1', invoiceId: 'inv1' }))
      .rejects.toThrow(/kid session for this family/i);
    // and a fam1 kid cannot reach into fam2
    await expect(acceptCounterOfferCore(db, kidAuth, { familyId: 'fam2', invoiceId: 'inv1' }))
      .rejects.toThrow(/kid session for this family/i);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(0);
  });
  it('rejects malformed ids before they reach a document path', async () => {
    await expect(acceptCounterOfferCore(db, kidAuth, { familyId: 'fam1', invoiceId: '../../fam2/invoices/inv9' }))
      .rejects.toThrow(/invoiceId/);
  });
});
