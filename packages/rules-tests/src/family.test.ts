import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where, writeBatch } from 'firebase/firestore';
import { setupTestEnv, parentCtx, kidCtx, seed } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), {
      name: 'Talero', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [],
    });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/fam1/kids/k1'), {
      name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
    });
    await setDoc(doc(db, 'families/fam2'), {
      name: 'Other', language: 'en', currency: 'USD', createdBy: 'px', deductionRules: [],
    });
  });
});

describe('family isolation', () => {
  it('member parent reads own family; outsider parent cannot', async () => {
    await assertSucceeds(getDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam1')));
    await assertFails(getDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam2')));
  });
  it('kid reads own family doc but not another family', async () => {
    await assertSucceeds(getDoc(doc(kidCtx(env, 'fam1', 'k1').firestore(), 'families/fam1')));
    await assertFails(getDoc(doc(kidCtx(env, 'fam1', 'k1').firestore(), 'families/fam2')));
  });
});

describe('family creation and immutability', () => {
  it('a signed-in parent creates a family with themself as founder member (batch)', async () => {
    const db = parentCtx(env, 'p9').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'families/fam9'), {
      name: 'New', language: 'en', currency: 'USD', createdBy: 'p9', deductionRules: [],
    });
    batch.set(doc(db, 'families/fam9/members/p9'), { role: 'parent', displayName: 'P9' });
    await assertSucceeds(batch.commit());
  });
  it('kid tokens cannot create families', async () => {
    const db = kidCtx(env, 'fam1', 'k1').firestore();
    await assertFails(setDoc(doc(db, 'families/fam8'), {
      name: 'X', language: 'en', currency: 'USD', createdBy: 'kid_fam1_k1', deductionRules: [],
    }));
  });
  it('currency is immutable, deductionRules not client-writable, name is editable', async () => {
    const db = parentCtx(env, 'p1').firestore();
    await assertFails(updateDoc(doc(db, 'families/fam1'), { currency: 'USD' }));
    await assertFails(updateDoc(doc(db, 'families/fam1'), { deductionRules: [{ nameEs: 'x', nameEn: 'x', basisPoints: 100, destination: 'withheld' }] }));
    await assertSucceeds(updateDoc(doc(db, 'families/fam1'), { name: 'Talero-Ruiz' }));
  });
});

describe('kids docs', () => {
  it('parent creates a kid with zero balances only', async () => {
    const db = parentCtx(env, 'p1').firestore();
    await assertSucceeds(setDoc(doc(db, 'families/fam1/kids/k2'), {
      name: 'Leo Jr', birthYear: 2019, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
    }));
    await assertFails(setDoc(doc(db, 'families/fam1/kids/k3'), {
      name: 'Rich', birthYear: 2019, deductionsEnabled: false, spendableBalance: 5000, savingsBalance: 0,
    }));
  });
  it('nobody client-side can touch balances; parent can edit other fields', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertFails(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { spendableBalance: 100 }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { savingsBalance: 100 }));
    await assertSucceeds(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { deductionsEnabled: true }));
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertFails(updateDoc(doc(kdb, 'families/fam1/kids/k1'), { spendableBalance: 100 }));
  });
  it('kid reads own doc, not a sibling doc; kid docs are not deletable', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(getDoc(doc(kdb, 'families/fam1/kids/k1')));
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'families/fam1/kids/k2'), {
        name: 'Sib', birthYear: 2014, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
      });
    });
    await assertFails(getDoc(doc(kdb, 'families/fam1/kids/k2')));
    await assertFails(deleteDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam1/kids/k1')));
  });
  it('kid cannot list the whole kids collection but a query constrained to their own doc succeeds', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertFails(getDocs(collection(kdb, 'families/fam1/kids')));
    const constrained = query(
      collection(kdb, 'families/fam1/kids'),
      where('__name__', '==', doc(kdb, 'families/fam1/kids/k1')),
    );
    await assertSucceeds(getDocs(constrained));
  });
});
