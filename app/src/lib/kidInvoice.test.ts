import { describe, it, expect, beforeEach } from 'vitest';
import {
  collection, doc, getDocFromServer, getDocsFromServer, query, where, writeBatch,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';
import { callables } from './callables.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { createDraft, updateDraft, deleteDraft } from './kidInvoice.js';

const familyId = 'famDraft';

async function seedKidSession(): Promise<void> {
  await signInTestParent('draftparent');
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
  await seedDoc(`families/${familyId}/kids/k2`, {
    name: 'Sib', birthYear: 2014, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  await signInTestKid(data.code);
}

beforeEach(async () => {
  await clearFirestoreData();
  await signOut(kidBundle().auth);
  await seedKidSession();
});

describe('createDraft', () => {
  it('writes a draft the rules accept, with a server timestamp', async () => {
    const kidFb = kidBundle();
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null,
      description: 'Leí un libro', requestedAmount: 5000,
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(snap.get('status')).toBe('draft');
    expect(snap.get('eventCount')).toBe(0);
    expect(snap.get('photoPaths')).toEqual([]);
    expect(snap.get('createdAt')).toBeTruthy();
    expect(Object.keys(snap.data()!).sort()).toEqual([
      'activityId', 'createdAt', 'description', 'eventCount',
      'kidId', 'photoPaths', 'requestedAmount', 'status',
    ]);
  });

  it('stores an optional pillar category for a free-form invoice', async () => {
    const kidFb = kidBundle();
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null,
      description: 'Ordené mi cuarto', requestedAmount: 3000, category: 'help',
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(snap.get('category')).toBe('help');
  });

  it('cannot create an invoice for a sibling', async () => {
    await expect(createDraft(kidBundle(), {
      familyId, kidId: 'k2', activityId: null, description: 'no', requestedAmount: 100,
    })).rejects.toThrow();
  });

  it('refuses a non-positive amount and an over-long description locally', async () => {
    await expect(createDraft(kidBundle(), {
      familyId, kidId: 'k1', activityId: null, description: 'x', requestedAmount: 0,
    })).rejects.toThrow(/amount/i);
    await expect(createDraft(kidBundle(), {
      familyId, kidId: 'k1', activityId: null, description: 'x'.repeat(1001), requestedAmount: 100,
    })).rejects.toThrow(/description/i);
  });
});

describe('updateDraft', () => {
  it('edits the fields a draft allows', async () => {
    const kidFb = kidBundle();
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null, description: 'antes', requestedAmount: 5000,
    });
    await updateDraft(kidFb, {
      familyId, invoiceId: id, status: 'draft',
      fields: { description: 'después', requestedAmount: 6000, activityId: 'act1' },
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(snap.get('description')).toBe('después');
    expect(snap.get('requestedAmount')).toBe(6000);
    expect(snap.get('activityId')).toBe('act1');
  });

  it('does not send activityId once the invoice has left draft', async () => {
    // the rules allow activityId edits ONLY in draft; sending it from a
    // returned invoice would fail the whole write, losing the kid's edit
    const kidFb = kidBundle();
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: 'act1', description: 'x', requestedAmount: 100,
    });
    await seedDoc(`families/${familyId}/invoices/${id}`, {
      kidId: 'k1', activityId: 'act1', description: 'x', photoPaths: [],
      status: 'returned', requestedAmount: 100, eventCount: 2, createdAt: new Date(),
    });
    await updateDraft(kidFb, {
      familyId, invoiceId: id, status: 'returned',
      fields: { description: 'mejor', requestedAmount: 200, activityId: 'act9' },
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(snap.get('description')).toBe('mejor');
    expect(snap.get('activityId')).toBe('act1'); // silently dropped, not rejected
  });

  it('cannot edit an approved invoice', async () => {
    const id = 'approved1';
    await seedDoc(`families/${familyId}/invoices/${id}`, {
      kidId: 'k1', activityId: null, description: 'x', photoPaths: [],
      status: 'approved', requestedAmount: 100, approvedAmount: 100, netAmount: 100,
      deductions: [], eventCount: 2, createdAt: new Date(),
    });
    await expect(updateDraft(kidBundle(), {
      familyId, invoiceId: id, status: 'approved', fields: { description: 'nope' },
    })).rejects.toThrow(/editable/i);
  });
});

describe('deleteDraft', () => {
  it('deletes a draft but not a sent invoice', async () => {
    const kidFb = kidBundle();
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null, description: 'x', requestedAmount: 100,
    });
    await deleteDraft(kidFb, familyId, id);

    // observe the absence through the kid's own constrained QUERY, not a
    // direct get: the kid read rule dereferences resource.data.kidId, so
    // getting a document that no longer exists is denied rather than
    // returning an empty snapshot. A query simply stops listing it, which is
    // also how the UI notices.
    const mine = query(
      collection(kidFb.db, `families/${familyId}/invoices`),
      where('kidId', '==', 'k1'),
    );
    expect((await getDocsFromServer(mine)).docs.map((d) => d.id)).not.toContain(id);

    await seedDoc(`families/${familyId}/invoices/sent1`, {
      kidId: 'k1', activityId: null, description: 'x', photoPaths: [],
      status: 'sent', requestedAmount: 100, eventCount: 1, createdAt: new Date(),
    });
    await expect(deleteDraft(kidFb, familyId, 'sent1')).rejects.toThrow();
    // and it is still there afterwards
    expect((await getDocsFromServer(mine)).docs.map((d) => d.id)).toContain('sent1');
  });
});
