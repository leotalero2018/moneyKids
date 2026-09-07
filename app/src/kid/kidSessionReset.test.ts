import { describe, it, expect, beforeEach } from 'vitest';
import { doc, getDocFromCache, getDocFromServer, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';
import { callables } from '../lib/callables.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { endKidSession } from './kidSessionReset.js';

const familyId = 'famReset';

beforeEach(async () => {
  await clearFirestoreData();
  await signOut(kidBundle().auth);
  await signInTestParent('resetparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  for (const kidId of ['k1', 'k2']) {
    await seedDoc(`families/${familyId}/kids/${kidId}`, {
      name: kidId === 'k1' ? 'Mia' : 'Sib', birthYear: 2016, deductionsEnabled: false,
      spendableBalance: 0, savingsBalance: 0,
    });
  }
});

async function codeFor(kidId: string): Promise<string> {
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId });
  return data.code;
}

describe('endKidSession', () => {
  it('replaces the instance and clears the credential', async () => {
    await signInTestKid(await codeFor('k1'));
    const first = kidBundle();
    await getDocFromServer(doc(first.db, `families/${familyId}/kids/k1`));

    await endKidSession();

    const second = kidBundle();
    // a NEW Firestore: the old one is terminated, so nothing can read
    // through it, and its cache went with it
    expect(second.db).not.toBe(first.db);
    expect(second.auth.currentUser).toBeNull();
    // nothing of the previous kid is readable from the fresh cache
    await expect(getDocFromCache(doc(second.db, `families/${familyId}/kids/k1`)))
      .rejects.toThrow();
    // and the terminated instance is genuinely dead. Passing a FUNCTION to
    // .rejects: getDocFromServer throws synchronously on a terminated
    // client, so handing it a bare promise never catches it.
    await expect(async () => getDocFromServer(doc(first.db, `families/${familyId}/kids/k1`)))
      .rejects.toThrow(/terminated/i);
  });

  // NOTE: that clearIndexedDbPersistence really erases the ON-DISK cache is
  // not observable here — jsdom has no IndexedDB, so this suite runs on the
  // memory cache and can only prove the instance is rebuilt. Task 13 asserts
  // the real thing in a browser: a second kid cannot read the first kid's
  // documents after a reload.

  it('keeps the app name stable, so a reload finds the same app', async () => {
    await signInTestKid(await codeFor('k1'));
    const firstName = kidBundle().app.name;
    await endKidSession();
    // a generation-suffixed name would sign the next kid out on reload, when
    // module state resets and re-initializes the original name
    expect(kidBundle().app.name).toBe(firstName);
    await endKidSession();
    expect(kidBundle().app.name).toBe(firstName);
  });

  it('lets the next kid sign in on the fresh instance', async () => {
    await signInTestKid(await codeFor('k1'));
    await endKidSession();
    await signInTestKid(await codeFor('k2'));
    expect(kidBundle().auth.currentUser!.uid).toBe(`kid_${familyId}_k2`);
    // and Mia's doc is denied outright, not served from a stale cache
    await expect(getDocFromServer(doc(kidBundle().db, `families/${familyId}/kids/k1`)))
      .rejects.toThrow();
  });
});
