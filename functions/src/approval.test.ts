import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { approveInvoiceCore } from './approval.js';

let db: Firestore;
const parentAuth = { uid: 'p1', token: {} } as never;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;

const rules = [
  { nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' },
  { nameEs: 'Impuesto', nameEn: 'Tax', basisPoints: 1000, destination: 'withheld' },
];

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

async function seedInvoice(deductionsEnabled: boolean, invoice: Record<string, unknown> = {}) {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: rules });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({ name: 'Mia', birthYear: 2016, deductionsEnabled, spendableBalance: 0, savingsBalance: 0 });
  await db.doc('families/fam1/invoices/inv1').set({
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'sent', requestedAmount: 10000, eventCount: 1, ...invoice,
  });
}

beforeEach(async () => { await seedInvoice(true); });

describe('approveInvoiceCore', () => {
  it('approves with deductions: freezes breakdown, writes ledger, updates balances', async () => {
    const result = await approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    expect(result).toEqual({ approvedAmount: 10000, netAmount: 7000 });

    const inv = await db.doc('families/fam1/invoices/inv1').get();
    expect(inv.get('status')).toBe('approved');
    expect(inv.get('netAmount')).toBe(7000);
    expect(inv.get('deductions')).toHaveLength(2);

    const credit = await db.doc('families/fam1/ledger/credit_inv1').get();
    expect(credit.get('amount')).toBe(7000);
    expect(credit.get('balance')).toBe('spendable');
    const savings = await db.doc('families/fam1/ledger/savings_inv1').get();
    expect(savings.get('amount')).toBe(2000);
    expect(savings.get('type')).toBe('savings-credit');

    const kid = await db.doc('families/fam1/kids/k1').get();
    expect(kid.get('spendableBalance')).toBe(7000);
    expect(kid.get('savingsBalance')).toBe(2000);

    const events = await db.collection('families/fam1/invoices/inv1/events').get();
    expect(events.docs.some((e) => e.get('to') === 'approved' && e.get('actorUid') === 'p1')).toBe(true);
  });

  it('honors the per-kid deductions toggle: gross credited, no savings entry', async () => {
    await seedInvoice(false);
    const result = await approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    expect(result).toEqual({ approvedAmount: 10000, netAmount: 10000 });
    const inv = await db.doc('families/fam1/invoices/inv1').get();
    expect(inv.get('deductions')).toEqual([]);
    expect((await db.doc('families/fam1/ledger/savings_inv1').get()).exists).toBe(false);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(10000);
  });

  it('double approval is impossible', async () => {
    await approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' }))
      .rejects.toThrow(/cannot approve/i);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(7000);
  });

  it('rejects kid callers and unaffiliated strangers', async () => {
    await expect(approveInvoiceCore(db, kidAuth, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow();
    await expect(approveInvoiceCore(db, { uid: 'stranger', token: {} } as never, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow();
  });

  it('rejects a real parent of ANOTHER family, in both directions, with no money moved', async () => {
    // a stranger uid only proves the membership lookup; family scoping needs a
    // caller who genuinely passes the parent-role check in their own family
    await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
    await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
    await db.doc('families/fam2/kids/k9').set({ name: 'Otro', birthYear: 2015, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
    await db.doc('families/fam2/invoices/inv9').set({
      kidId: 'k9', activityId: null, description: 'suyo', photoPaths: [],
      status: 'sent', requestedAmount: 4000, eventCount: 1,
    });

    // fam2's parent cannot approve fam1's invoice
    await expect(approveInvoiceCore(db, { uid: 'p2', token: {} } as never, { familyId: 'fam1', invoiceId: 'inv1' }))
      .rejects.toThrow(/not a member/i);
    // fam1's parent cannot approve fam2's invoice
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam2', invoiceId: 'inv9' }))
      .rejects.toThrow(/not a member/i);
    // an invoice id from the OTHER family, passed under the caller's own familyId,
    // must not resolve — invoices are addressed within the family subtree
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv9' }))
      .rejects.toThrow(/not found/i);

    // nothing was credited anywhere
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(0);
    expect((await db.doc('families/fam2/kids/k9').get()).get('spendableBalance')).toBe(0);
    await db.recursiveDelete(db.collection('families').doc('fam2'));
  });

  it('rejects malformed ids before they reach a document path', async () => {
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1/../inv2' }))
      .rejects.toThrow(/invoiceId/);
    await expect(approveInvoiceCore(db, parentAuth, { familyId: '..', invoiceId: 'inv1' }))
      .rejects.toThrow(/familyId/);
  });

  it('rejects approving a one-time activity twice for the same kid', async () => {
    await db.doc('families/fam1/activities/act1').set({
      titleEs: 'Valentía', titleEn: 'Courage', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 3000, category: 'courage', repeatable: false, active: true,
    });
    await db.doc('families/fam1/invoices/inv1').update({ activityId: 'act1' });
    await approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    await db.doc('families/fam1/invoices/inv2').set({
      kidId: 'k1', activityId: 'act1', description: 'otra vez', photoPaths: [],
      status: 'sent', requestedAmount: 3000, eventCount: 1,
    });
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv2' }))
      .rejects.toThrow(/one-time/i);
  });
});
