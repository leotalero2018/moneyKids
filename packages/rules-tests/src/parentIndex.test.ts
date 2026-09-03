import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { setupTestEnv, parentCtx, seed } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), {
      name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [],
    });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
  });
});

describe('parentIndex', () => {
  it('a parent creates their own pointer alongside their member doc', async () => {
    const db = parentCtx(env, 'p9').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'families/fam9'), {
      name: 'New', language: 'en', currency: 'USD', createdBy: 'p9', deductionRules: [],
    });
    batch.set(doc(db, 'families/fam9/members/p9'), { role: 'parent', displayName: 'P9' });
    batch.set(doc(db, 'parentIndex/p9'), { familyId: 'fam9' });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(db, 'parentIndex/p9')));
  });
  it('cannot point at a family you are not a member of', async () => {
    const db = parentCtx(env, 'intruder').firestore();
    await assertFails(setDoc(doc(db, 'parentIndex/intruder'), { familyId: 'fam1' }));
  });
  it('cannot write or read someone else\'s pointer', async () => {
    const db = parentCtx(env, 'p9').firestore();
    await assertFails(setDoc(doc(db, 'parentIndex/p1'), { familyId: 'fam1' }));
    await assertFails(getDoc(doc(db, 'parentIndex/p1')));
  });
  it('is immutable once written', async () => {
    const db = parentCtx(env, 'p1').firestore();
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'parentIndex/p1'), { familyId: 'fam1' });
    });
    await assertFails(setDoc(doc(db, 'parentIndex/p1'), { familyId: 'fam2' }));
  });
});
