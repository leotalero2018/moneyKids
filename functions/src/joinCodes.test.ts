import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { createJoinCodeCore, mintKidTokenCore, revokeKidAccessCore } from './joinCodes.js';

// Requires FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST (set by emulators:exec)
let db: Firestore;
let adminAuth: Auth;
const parentAuth = { uid: 'p1', token: {} } as never;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
  adminAuth = getAuth();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  const codes = await db.collection('joinCodes').get();
  await Promise.all(codes.docs.map((d) => d.ref.delete()));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({ name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
  // a SECOND, real family — 'stranger' proves only the membership check;
  // family scoping needs an actual member of another family
  await db.recursiveDelete(db.collection('families').doc('fam2'));
  await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
  await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
  await db.doc('families/fam2/kids/k9').set({ name: 'Otro', birthYear: 2015, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
});

const foreignParentAuth = { uid: 'p2', token: {} } as never; // real parent of fam2

describe('createJoinCodeCore', () => {
  it('parent gets a code stored with the right target', async () => {
    const { code } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    const snap = await db.doc(`joinCodes/${code}`).get();
    expect(snap.get('familyId')).toBe('fam1');
    expect(snap.get('kidId')).toBe('k1');
    expect(snap.get('revoked')).toBe(false);
  });
  it('rejects non-members, kid tokens, and cross-family kid targets', async () => {
    await expect(createJoinCodeCore(db, { uid: 'stranger', token: {} } as never, { familyId: 'fam1', kidId: 'k1' })).rejects.toThrow(/permission-denied|not a member/i);
    await expect(createJoinCodeCore(db, kidAuth, { familyId: 'fam1', kidId: 'k1' })).rejects.toThrow();
    await expect(createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'ghost' })).rejects.toThrow(/not found/i);
  });
  it('rejects members whose role is not parent', async () => {
    await db.doc('families/fam1/members/aunt').set({ role: 'viewer', displayName: 'Tía' });
    await expect(createJoinCodeCore(db, { uid: 'aunt', token: {} } as never, { familyId: 'fam1', kidId: 'k1' })).rejects.toThrow(/parent role/i);
  });
  it('rejects a real parent of another family targeting this family', async () => {
    await expect(createJoinCodeCore(db, foreignParentAuth, { familyId: 'fam1', kidId: 'k1' }))
      .rejects.toThrow(/not a member/i);
    // ...and cannot reach across to a kid of their own family from fam1's scope
    await expect(createJoinCodeCore(db, foreignParentAuth, { familyId: 'fam1', kidId: 'k9' }))
      .rejects.toThrow(/not a member/i);
    // the mirror direction: fam1's parent cannot target fam2
    await expect(createJoinCodeCore(db, parentAuth, { familyId: 'fam2', kidId: 'k9' }))
      .rejects.toThrow(/not a member/i);
  });
  it('rejects malformed ids before they reach a document path', async () => {
    await expect(createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1/../k9' }))
      .rejects.toThrow(/kidId/);
    await expect(createJoinCodeCore(db, parentAuth, { familyId: 'fam1/members/p1', kidId: 'k1' }))
      .rejects.toThrow(/familyId/);
    await expect(createJoinCodeCore(db, parentAuth, { familyId: '', kidId: 'k1' }))
      .rejects.toThrow(/familyId/);
  });
});

describe('mintKidTokenCore', () => {
  it('mints a custom token for a valid code', async () => {
    const { code } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    const { token } = await mintKidTokenCore(db, adminAuth, { code });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });
  it('rejects unknown, revoked, and expired codes', async () => {
    await expect(mintKidTokenCore(db, adminAuth, { code: 'NOPE9999' })).rejects.toThrow(/invalid/i);
    const { code } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    await db.doc(`joinCodes/${code}`).update({ revoked: true });
    await expect(mintKidTokenCore(db, adminAuth, { code })).rejects.toThrow(/invalid/i);
    const { code: code2 } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    await db.doc(`joinCodes/${code2}`).update({ expiresAt: new Date(Date.now() - 1000) });
    await expect(mintKidTokenCore(db, adminAuth, { code: code2 })).rejects.toThrow(/invalid/i);
  });
  it('rejects malformed codes as plain invalid, leaking nothing', async () => {
    // public callable: a malformed code must be indistinguishable from a wrong one
    for (const bad of ['', 'abc', 'abcd2345', 'ABCD/../X', 'ABCD23450', 'ABCD2340']) {
      await expect(mintKidTokenCore(db, adminAuth, { code: bad })).rejects.toThrow(/invalid/i);
    }
  });
});

describe('revokeKidAccessCore', () => {
  it('revokes all codes for the kid and their refresh tokens', async () => {
    const { code } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    await revokeKidAccessCore(db, adminAuth, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    const snap = await db.doc(`joinCodes/${code}`).get();
    expect(snap.get('revoked')).toBe(true);
    await expect(mintKidTokenCore(db, adminAuth, { code })).rejects.toThrow(/invalid/i);
  });
  it('rejects non-parent callers', async () => {
    await expect(revokeKidAccessCore(db, adminAuth, kidAuth, { familyId: 'fam1', kidId: 'k1' })).rejects.toThrow();
  });
  it('rejects a real parent of another family, and malformed ids', async () => {
    await expect(revokeKidAccessCore(db, adminAuth, foreignParentAuth, { familyId: 'fam1', kidId: 'k1' }))
      .rejects.toThrow(/not a member/i);
    await expect(revokeKidAccessCore(db, adminAuth, parentAuth, { familyId: 'fam1', kidId: '../k9' }))
      .rejects.toThrow(/kidId/);
  });
});
