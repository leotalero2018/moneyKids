import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { recordPayoutCore } from './payout.js';

let db: Firestore;
const parentAuth = { uid: 'p1', token: {} } as never;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({ name: 'Mia', birthYear: 2016, deductionsEnabled: true, spendableBalance: 7000, savingsBalance: 2000 });
});

describe('recordPayoutCore', () => {
  it('debits the chosen balance and writes an idempotent ledger entry', async () => {
    await recordPayoutCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 3000, note: 'efectivo', requestId: 'req-0001' });
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(4000);
    const entry = await db.doc('families/fam1/ledger/payout_req-0001').get();
    expect(entry.get('type')).toBe('payout');
    expect(entry.get('balance')).toBe('spendable');
    expect(entry.get('amount')).toBe(3000);
    // retry with same requestId + identical payload: idempotent success, no double debit
    await recordPayoutCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 3000, note: 'efectivo', requestId: 'req-0001' });
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(4000);
    // same requestId with a different payload: rejected, still no double debit
    await expect(recordPayoutCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 100, note: 'efectivo', requestId: 'req-0001' })).rejects.toThrow(/mismatch/i);
    // same payload but a DIFFERENT parent: also rejected (not their payout)
    await db.doc('families/fam1/members/p2').set({ role: 'parent', displayName: 'Ana' });
    await expect(recordPayoutCore(db, { uid: 'p2', token: {} } as never, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 3000, note: 'efectivo', requestId: 'req-0001' })).rejects.toThrow(/mismatch/i);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(4000);
  });
  it('savings payouts debit savings', async () => {
    await recordPayoutCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1', balance: 'savings', amount: 2000, note: '', requestId: 'req-0002' });
    expect((await db.doc('families/fam1/kids/k1').get()).get('savingsBalance')).toBe(0);
  });
  it('rejects zero, negative, over-balance, and kid callers', async () => {
    const base = { familyId: 'fam1', kidId: 'k1', balance: 'spendable' as const, note: '', requestId: 'req-0003' };
    await expect(recordPayoutCore(db, parentAuth, { ...base, amount: 0 })).rejects.toThrow(/amount/i);
    await expect(recordPayoutCore(db, parentAuth, { ...base, amount: -5 })).rejects.toThrow(/amount/i);
    await expect(recordPayoutCore(db, parentAuth, { ...base, amount: 7001 })).rejects.toThrow(/exceeds/i);
    await expect(recordPayoutCore(db, kidAuth, { ...base, amount: 100 })).rejects.toThrow();
  });

  it('rejects a real parent of another family, with no debit', async () => {
    await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
    await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
    const foreign = { uid: 'p2', token: {} } as never;
    await expect(recordPayoutCore(db, foreign, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 1000, note: '', requestId: 'req-0004' }))
      .rejects.toThrow(/not a member/i);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(7000);
    await db.recursiveDelete(db.collection('families').doc('fam2'));
  });

  it('rejects malformed payloads before any path or ledger ID is built', async () => {
    const base = { familyId: 'fam1', kidId: 'k1', balance: 'spendable' as const, note: '', amount: 100 };
    // requestId becomes part of the ledger doc ID — must not carry separators.
    // (Note it CAN legitimately contain '_': the 'payout_' prefix keeps
    // 'payout_credit_inv1' a distinct doc from 'credit_inv1', so only path
    // separators and out-of-range lengths are rejected.)
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: 'r1' })).rejects.toThrow(/requestId/);
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: '../credit_inv1' })).rejects.toThrow(/requestId/);
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: 'req-0005', kidId: 'k1/../k2' })).rejects.toThrow(/kidId/);
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: 'req-0005', balance: 'pocket' as never })).rejects.toThrow(/balance/);
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: 'req-0005', note: 'x'.repeat(501) })).rejects.toThrow(/note/);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(7000);
  });
});
