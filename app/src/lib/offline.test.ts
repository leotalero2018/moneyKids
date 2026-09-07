import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  collection, disableNetwork, doc, enableNetwork, getDocFromCache, getDocFromServer,
  getDocs, query, waitForPendingWrites, where, writeBatch,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';
import { callables } from './callables.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { createDraft } from './kidInvoice.js';

const familyId = 'famOff';

beforeEach(async () => {
  await clearFirestoreData();
  await signOut(kidBundle().auth);
  await signInTestParent('offparent');
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
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  await signInTestKid(data.code);
});

afterEach(async () => { await enableNetwork(kidBundle().db); });

describe('offline drafts', () => {
  it('a draft written offline is readable locally and syncs on reconnect', async () => {
    const kidFb = kidBundle();
    await disableNetwork(kidFb.db);
    // createDraft returns the id without awaiting the server, which is what
    // makes offline drafting possible at all
    const { id } = createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null,
      description: 'Escrito sin internet', requestedAmount: 4000,
    });

    // the kid can still see their own work
    const cached = await getDocFromCache(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(cached.get('description')).toBe('Escrito sin internet');
    // ...and the server does not have it yet
    const beforeSync = await getDocs(query(
      collection(parentFb.db, `families/${familyId}/invoices`),
    ));
    expect(beforeSync.size).toBe(0);

    await enableNetwork(kidFb.db);
    // a plain retry loop rather than expect.poll, which is not in every
    // vitest 2.x: this must not depend on the runner's minor version
    let synced = false;
    for (let attempt = 0; attempt < 40 && !synced; attempt += 1) {
      synced = (await getDocFromServer(
        doc(kidFb.db, `families/${familyId}/invoices/${id}`),
      ).catch(() => ({ exists: () => false }))).exists();
      if (!synced) await new Promise((r) => setTimeout(r, 250));
    }
    expect(synced).toBe(true);
  });

  // NOTE: only ONE disableNetwork cycle per file. A second one trips
  // "FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state" in the 10.x SDK,
  // and the coverage it would add is already here — the assertion above
  // proves the server has nothing while the client is offline.
  //
  // The other offline limit is not testable in jsdom at all: photos need
  // connectivity, because the Storage rule authorizes an upload by READING
  // the linked invoice, and a draft that exists only in the local cache has
  // nothing to authorize against. The kid is told so in kidNew.photoFailed,
  // and Task 13 exercises the real path in a browser.
});
