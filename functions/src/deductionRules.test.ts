import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { setDeductionRulesCore } from './deductionRules.js';

let db: Firestore;
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
});

describe('setDeductionRulesCore', () => {
  it('writes valid rules', async () => {
    await setDeductionRulesCore(db, parentAuth, {
      familyId: 'fam1',
      rules: [{ nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' }],
    });
    const fam = await db.doc('families/fam1').get();
    expect(fam.get('deductionRules')).toHaveLength(1);
  });
  it('rejects invalid rules and non-members', async () => {
    await expect(setDeductionRulesCore(db, parentAuth, {
      familyId: 'fam1',
      rules: [{ nameEs: 'X', nameEn: 'X', basisPoints: 10001, destination: 'withheld' }],
    })).rejects.toThrow(/exceed/i);
    await expect(setDeductionRulesCore(db, { uid: 'stranger', token: {} } as never, { familyId: 'fam1', rules: [] })).rejects.toThrow();
  });
  it('rejects a real parent of another family and malformed familyId', async () => {
    await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
    await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
    await expect(setDeductionRulesCore(db, { uid: 'p2', token: {} } as never, {
      familyId: 'fam1',
      rules: [{ nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 9000, destination: 'savings' }],
    })).rejects.toThrow(/not a member/i);
    expect((await db.doc('families/fam1').get()).get('deductionRules')).toEqual([]);
    await expect(setDeductionRulesCore(db, parentAuth, { familyId: 'fam1/../fam2', rules: [] }))
      .rejects.toThrow(/familyId/);
    await db.recursiveDelete(db.collection('families').doc('fam2'));
  });
});
