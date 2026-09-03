import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { setupTestEnv, parentCtx, kidCtx, seed } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), { name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/fam1/ledger/credit_inv1'), {
      kidId: 'k1', type: 'credit', balance: 'spendable', amount: 5000, invoiceId: 'inv1', createdBy: 'p1', at: new Date(),
    });
    await setDoc(doc(db, 'families/fam1/ledger/credit_inv2'), {
      kidId: 'k2', type: 'credit', balance: 'spendable', amount: 900, invoiceId: 'inv2', createdBy: 'p1', at: new Date(),
    });
    await setDoc(doc(db, 'joinCodes/ABC123'), { familyId: 'fam1', kidId: 'k1', revoked: false, expiresAt: new Date() });
  });
});

describe('ledger', () => {
  it('parent reads all; kid reads only own entries via constrained query', async () => {
    await assertSucceeds(getDocs(collection(parentCtx(env, 'p1').firestore(), 'families/fam1/ledger')));
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(getDocs(query(collection(kdb, 'families/fam1/ledger'), where('kidId', '==', 'k1'))));
    await assertFails(getDocs(collection(kdb, 'families/fam1/ledger')));
    await assertFails(getDoc(doc(kdb, 'families/fam1/ledger/credit_inv2')));
  });
  it('no client can write the ledger', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertFails(setDoc(doc(pdb, 'families/fam1/ledger/payout_x'), {
      kidId: 'k1', type: 'payout', balance: 'spendable', amount: 100, createdBy: 'p1', at: new Date(),
    }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/ledger/credit_inv1'), { amount: 999999 }));
  });
});

describe('joinCodes', () => {
  it('is client-inaccessible to everyone', async () => {
    await assertFails(getDoc(doc(parentCtx(env, 'p1').firestore(), 'joinCodes/ABC123')));
    await assertFails(getDoc(doc(kidCtx(env, 'fam1', 'k1').firestore(), 'joinCodes/ABC123')));
  });
});

describe('parent invites are server-only', () => {
  it('no client can read or write parentInvites', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertFails(getDoc(doc(pdb, 'parentInvites/ABCD2345')));
    await assertFails(setDoc(doc(pdb, 'parentInvites/ABCD2345'), { familyId: 'fam1' }));
  });
  it('family parents read the invite log but cannot write it', async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'families/fam1/inviteLog/ABCD2345'), {
        createdBy: 'p1', createdAt: new Date(), usedBy: null, usedAt: null,
      });
    });
    const pdb = parentCtx(env, 'p1').firestore();
    await assertSucceeds(getDoc(doc(pdb, 'families/fam1/inviteLog/ABCD2345')));
    await assertFails(setDoc(doc(pdb, 'families/fam1/inviteLog/XXXX2345'), { createdBy: 'p1' }));
  });
});
