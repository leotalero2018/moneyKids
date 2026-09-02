import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { setupTestEnv, parentCtx, kidCtx, seed } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const path = (kid: string, inv: string) => `families/fam1/kids/${kid}/invoices/${inv}/photo1.png`;

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), { name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/fam1/invoices/inv1'), { kidId: 'k1', status: 'draft', requestedAmount: 100, description: '', photoPaths: [] });
    await setDoc(doc(db, 'families/fam1/invoices/inv2'), { kidId: 'k1', status: 'approved', requestedAmount: 100, description: '', photoPaths: [] });
    // sibling k2's editable invoice — used to prove path/owner binding
    await setDoc(doc(db, 'families/fam1/invoices/inv3'), { kidId: 'k2', status: 'draft', requestedAmount: 100, description: '', photoPaths: [] });
  });
});

describe('photo storage', () => {
  it('owning kid uploads to own editable invoice', async () => {
    const storage = kidCtx(env, 'fam1', 'k1').storage();
    await assertSucceeds(uploadBytes(ref(storage, path('k1', 'inv1')), png, { contentType: 'image/png' }));
  });
  it('sibling kid can neither upload nor read', async () => {
    const owner = kidCtx(env, 'fam1', 'k1').storage();
    await assertSucceeds(uploadBytes(ref(owner, path('k1', 'inv1')), png, { contentType: 'image/png' }));
    const sibling = kidCtx(env, 'fam1', 'k2').storage();
    await assertFails(uploadBytes(ref(sibling, path('k1', 'inv1')), png, { contentType: 'image/png' }));
    await assertFails(getBytes(ref(sibling, path('k1', 'inv1'))));
  });
  it('parent reads any family photo', async () => {
    const owner = kidCtx(env, 'fam1', 'k1').storage();
    await assertSucceeds(uploadBytes(ref(owner, path('k1', 'inv1')), png, { contentType: 'image/png' }));
    await assertSucceeds(getBytes(ref(parentCtx(env, 'p1').storage(), path('k1', 'inv1'))));
  });
  it('rejects a kid attaching a SIBLING\'s invoice under their own prefix', async () => {
    // inv3 belongs to k2 and is editable; k1 writes it under k1's own path,
    // so every owner check on the path segment passes — only the invoice's
    // own kidId stops this. Regression guard for the storage ownership bug.
    const storage = kidCtx(env, 'fam1', 'k1').storage();
    await assertFails(uploadBytes(ref(storage, path('k1', 'inv3')), png, { contentType: 'image/png' }));
  });
  it('rejects uploads to approved invoices and non-image content', async () => {
    const storage = kidCtx(env, 'fam1', 'k1').storage();
    await assertFails(uploadBytes(ref(storage, path('k1', 'inv2')), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(storage, path('k1', 'inv1')), png, { contentType: 'application/pdf' }));
  });
});
