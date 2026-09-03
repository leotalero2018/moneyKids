import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { createParentInviteCore, acceptParentInviteCore } from './parentInvites.js';

let db: Firestore;
const parentAuth = { uid: 'p1', token: {} } as never;
const newcomerAuth = { uid: 'p3', token: {} } as never;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.recursiveDelete(db.collection('families').doc('fam2'));
  for (const c of (await db.collection('parentInvites').get()).docs) await c.ref.delete();
  for (const c of (await db.collection('parentIndex').get()).docs) await c.ref.delete();
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
  await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
});

describe('createParentInviteCore', () => {
  it('a parent creates a code recorded in the family invite log', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    const invite = await db.doc(`parentInvites/${code}`).get();
    expect(invite.get('familyId')).toBe('fam1');
    expect(invite.get('usedBy')).toBeNull();
    const log = await db.doc(`families/fam1/inviteLog/${code}`).get();
    expect(log.get('createdBy')).toBe('p1');
  });
  it('rejects kid tokens, strangers, and a real parent of another family', async () => {
    await expect(createParentInviteCore(db, kidAuth, { familyId: 'fam1' })).rejects.toThrow();
    await expect(createParentInviteCore(db, { uid: 'stranger', token: {} } as never, { familyId: 'fam1' }))
      .rejects.toThrow(/not a member/i);
    await expect(createParentInviteCore(db, { uid: 'p2', token: {} } as never, { familyId: 'fam1' }))
      .rejects.toThrow(/not a member/i);
    await expect(createParentInviteCore(db, parentAuth, { familyId: 'fam2' }))
      .rejects.toThrow(/not a member/i);
  });
  it('rejects a malformed familyId before it reaches a path', async () => {
    await expect(createParentInviteCore(db, parentAuth, { familyId: 'fam1/../fam2' }))
      .rejects.toThrow(/familyId/);
  });
});

describe('acceptParentInviteCore', () => {
  it('makes the newcomer a parent and points them at the family', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    const { familyId } = await acceptParentInviteCore(db, newcomerAuth, { code });
    expect(familyId).toBe('fam1');
    expect((await db.doc('families/fam1/members/p3').get()).get('role')).toBe('parent');
    expect((await db.doc('parentIndex/p3').get()).get('familyId')).toBe('fam1');
    const log = await db.doc(`families/fam1/inviteLog/${code}`).get();
    expect(log.get('usedBy')).toBe('p3');
  });
  it('is single-use', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    await acceptParentInviteCore(db, newcomerAuth, { code });
    await expect(acceptParentInviteCore(db, { uid: 'p4', token: {} } as never, { code }))
      .rejects.toThrow(/invalid/i);
    expect((await db.doc('families/fam1/members/p4').get()).exists).toBe(false);
  });
  it('rejects expired, unknown, and malformed codes identically', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    await db.doc(`parentInvites/${code}`).update({ expiresAt: new Date(Date.now() - 1000) });
    await expect(acceptParentInviteCore(db, newcomerAuth, { code })).rejects.toThrow(/invalid/i);
    for (const bad of ['', 'abc', 'abcd2345', 'ABCD/../X', 'ABCD2340']) {
      await expect(acceptParentInviteCore(db, newcomerAuth, { code: bad })).rejects.toThrow(/invalid/i);
    }
  });
  it('rejects a kid token even with a valid code', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    await expect(acceptParentInviteCore(db, kidAuth, { code })).rejects.toThrow(/parent/i);
    expect((await db.doc('families/fam1/members/kid_fam1_k1').get()).exists).toBe(false);
  });
  it('refuses a caller who already belongs to another family', async () => {
    // one parent, one family in v1: a second pointer would be unreachable and
    // parentIndex is immutable by rule, so this must fail before any write
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    await db.doc('parentIndex/p2').set({ familyId: 'fam2' });
    await expect(acceptParentInviteCore(db, { uid: 'p2', token: {} } as never, { code }))
      .rejects.toThrow(/already belongs/i);
    expect((await db.doc('parentIndex/p2').get()).get('familyId')).toBe('fam2');
  });
});
