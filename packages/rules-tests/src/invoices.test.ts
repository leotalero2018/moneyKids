import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, query, where, serverTimestamp,
} from 'firebase/firestore';
import { setupTestEnv, parentCtx, kidCtx, seed } from './helpers.js';
import type { RulesTestEnvironment, RulesTestContext } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });

const draft = {
  kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
  status: 'draft', requestedAmount: 5000, eventCount: 0,
};

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), { name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/fam1/kids/k1'), { name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
    await setDoc(doc(db, 'families/fam1/kids/k2'), { name: 'Sib', birthYear: 2014, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
    await setDoc(doc(db, 'families/fam1/activities/act1'), {
      titleEs: 'Lee un libro', titleEn: 'Read a book', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 5000, category: 'learn', repeatable: true, active: true,
    });
  });
});

// eventCount = the invoice's NEW event count after this transition (previous + 1)
function sendBatch(db: ReturnType<RulesTestContext['firestore']>, invoiceId: string, from: string, amount: number, eventCount: number) {
  const batch = writeBatch(db);
  batch.update(doc(db, `families/fam1/invoices/${invoiceId}`), { status: 'sent', requestedAmount: amount, eventCount });
  batch.set(doc(db, `families/fam1/invoices/${invoiceId}/events/e${eventCount}`), {
    from, to: 'sent', actorUid: 'kid_fam1_k1', at: serverTimestamp(), requestedAmount: amount, kidId: 'k1',
  });
  return batch.commit();
}

describe('activities', () => {
  it('parent writes activities; kid reads but cannot write', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertSucceeds(setDoc(doc(pdb, 'families/fam1/activities/act2'), {
      titleEs: 'Valentía', titleEn: 'Courage', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 3000, category: 'courage', repeatable: false, active: true,
    }));
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(getDoc(doc(kdb, 'families/fam1/activities/act1')));
    await assertFails(updateDoc(doc(kdb, 'families/fam1/activities/act1'), { suggestedPrice: 999999 }));
  });

  it('activity writes are field-whitelisted and type-checked', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    const valid = {
      titleEs: 'Valentía', titleEn: 'Courage', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 3000, category: 'courage', repeatable: false, active: true,
    };
    await assertSucceeds(setDoc(doc(pdb, 'families/fam1/activities/ok'), valid));
    // unknown keys cannot be smuggled onto the activity
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/bad1'), { ...valid, injected: 'x' }));
    // required keys must all be present
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/bad2'), { titleEs: 'x', suggestedPrice: 10 }));
    // types are enforced
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/bad3'), { ...valid, titleEs: 42 }));
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/bad4'), { ...valid, repeatable: 'yes' }));
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/bad5'), { ...valid, active: 1 }));
    // category is one of the four pillars
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/bad6'), { ...valid, category: 'chores' }));
    // free text is bounded
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/bad7'), { ...valid, titleEs: 'x'.repeat(81) }));
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/bad8'), { ...valid, descriptionEs: 'x'.repeat(501) }));
    // and the same whitelist applies on update
    await assertFails(updateDoc(doc(pdb, 'families/fam1/activities/ok'), { injected: 'x' }));
    await assertSucceeds(updateDoc(doc(pdb, 'families/fam1/activities/ok'), { active: false }));
  });
});

describe('invoice lifecycle', () => {
  it('kid creates own draft; cannot create for a sibling; parent cannot create', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv2'), { ...draft, kidId: 'k2' }));
    await assertFails(setDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam1/invoices/inv3'), draft));
  });

  it('create is field-whitelisted: no money fields, no nonzero eventCount', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, netAmount: 5000 }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, approvedAmount: 5000 }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, deductions: [] }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, eventCount: 3 }));
  });

  it('create requires every field and enforces types', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    // hasOnly permits omissions; hasAll is what makes a partial invoice impossible
    const { description: _d, ...noDescription } = draft;
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/bad1'), noDescription));
    const { photoPaths: _p, ...noPhotos } = draft;
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/bad2'), noPhotos));
    // types are enforced on the free-text and list fields
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/bad3'), { ...draft, description: 42 }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/bad4'), { ...draft, photoPaths: 'p1.png' }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/bad5'), { ...draft, description: 'x'.repeat(1001) }));
    // activityId is either null or a string, never an object
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/bad6'), { ...draft, activityId: { a: 1 } }));
    // the positive path still works, proving the denials are specific
    await assertSucceeds(setDoc(doc(kdb, 'families/fam1/invoices/good'), draft));
  });

  it('edits cannot exceed the description bound either', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { description: 'x'.repeat(1001) }));
    await assertSucceeds(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { description: 'corto' }));
  });

  it('counterOffer is a closed, bounded map', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    const pdb = parentCtx(env, 'p1').firestore();

    const counter = (offer: Record<string, unknown>) => {
      const batch = writeBatch(pdb);
      batch.update(doc(pdb, 'families/fam1/invoices/inv1'), {
        status: 'countered', eventCount: 2, counterOffer: offer,
      });
      batch.set(doc(pdb, 'families/fam1/invoices/inv1/events/e2'), {
        from: 'sent', to: 'countered', actorUid: 'p1', at: serverTimestamp(), note: 'menos', kidId: 'k1',
      });
      return batch.commit();
    };

    // extra keys inside the map are rejected
    await assertFails(counter({ amount: 3000, note: 'menos', parentId: 'p1', at: serverTimestamp(), secret: 'x' }));
    // note must be a bounded string
    await assertFails(counter({ amount: 3000, note: 'x'.repeat(501), parentId: 'p1', at: serverTimestamp() }));
    await assertFails(counter({ amount: 3000, note: 42, parentId: 'p1', at: serverTimestamp() }));
    // and the well-formed counter-offer succeeds, proving the denials are specific
    await assertSucceeds(counter({ amount: 3000, note: 'menos', parentId: 'p1', at: serverTimestamp() }));
  });

  it('event notes are bounded', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    const pdb = parentCtx(env, 'p1').firestore();
    const ret = (note: unknown) => {
      const batch = writeBatch(pdb);
      batch.update(doc(pdb, 'families/fam1/invoices/inv1'), { status: 'returned', eventCount: 2 });
      batch.set(doc(pdb, 'families/fam1/invoices/inv1/events/e2'), {
        from: 'sent', to: 'returned', actorUid: 'p1', at: serverTimestamp(), note, kidId: 'k1',
      });
      return batch.commit();
    };
    await assertFails(ret('x'.repeat(501)));
    await assertFails(ret(42));
    await assertSucceeds(ret('explica un poco más'));
  });

  it('caps photos per invoice at 8 on create and on edit', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    const paths = (n: number) => Array.from({ length: n }, (_, i) => `families/fam1/kids/k1/invoices/inv1/p${i}.png`);
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, photoPaths: paths(9) }));
    await assertSucceeds(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, photoPaths: paths(8) }));
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { photoPaths: paths(9) }));
  });

  it('kid sends draft with a matching event; send without an event fails', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { status: 'sent', eventCount: 1 }));
    await assertSucceeds(sendBatch(kdb, 'inv1', 'draft', 5000, 1));
  });

  it('fabricated standalone events are rejected', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    // event alone, no invoice transition in the batch: from == to, wrong id → denied
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1/events/e2'), {
      from: 'sent', to: 'approved', actorUid: 'kid_fam1_k1', at: serverTimestamp(), kidId: 'k1',
    }));
  });

  it('standalone e0 on a fresh draft is denied (from != to is load-bearing)', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    // eventCount is still 0, so 'e0' satisfies the deterministic-ID check. With no
    // invoice write in the batch the only thing left to stop it is from != to.
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1/events/e0'), {
      from: 'draft', to: 'draft', actorUid: 'kid_fam1_k1', at: serverTimestamp(), kidId: 'k1',
    }));
    // claiming a transition that did not happen fails the to == invAfter().status check
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1/events/e0'), {
      from: 'draft', to: 'sent', actorUid: 'kid_fam1_k1', at: serverTimestamp(), requestedAmount: 5000, kidId: 'k1',
    }));
  });

  it('events are key-whitelisted: no extra keys, no requestedAmount on non-sent events', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);

    // otherwise-valid send batch, but the event smuggles a money field into the
    // permanently immutable audit log
    const smuggle = writeBatch(kdb);
    smuggle.update(doc(kdb, 'families/fam1/invoices/inv1'), { status: 'sent', requestedAmount: 5000, eventCount: 1 });
    smuggle.set(doc(kdb, 'families/fam1/invoices/inv1/events/e1'), {
      from: 'draft', to: 'sent', actorUid: 'kid_fam1_k1', at: serverTimestamp(),
      requestedAmount: 5000, kidId: 'k1', netAmount: 999999,
    });
    await assertFails(smuggle.commit());

    // a legitimate send, then a return whose event carries requestedAmount it has no business holding
    await assertSucceeds(sendBatch(kdb, 'inv1', 'draft', 5000, 1));
    const pdb = parentCtx(env, 'p1').firestore();
    const ret = writeBatch(pdb);
    ret.update(doc(pdb, 'families/fam1/invoices/inv1'), { status: 'returned', eventCount: 2 });
    ret.set(doc(pdb, 'families/fam1/invoices/inv1/events/e2'), {
      from: 'sent', to: 'returned', actorUid: 'p1', at: serverTimestamp(), requestedAmount: 999999, kidId: 'k1',
    });
    await assertFails(ret.commit());
  });

  it('a sibling kid cannot read another kid\'s invoice or its events', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);

    const sib = kidCtx(env, 'fam1', 'k2').firestore();
    await assertFails(getDoc(doc(sib, 'families/fam1/invoices/inv1')));
    await assertFails(getDoc(doc(sib, 'families/fam1/invoices/inv1/events/e1')));
    await assertFails(getDocs(query(collection(sib, 'families/fam1/invoices/inv1/events'), where('kidId', '==', 'k1'))));
    await assertFails(getDocs(collection(sib, 'families/fam1/invoices/inv1/events')));
  });

  it('kid cannot edit a sent invoice; parent returns it; kid edits and resends', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { description: 'edited' }));

    const pdb = parentCtx(env, 'p1').firestore();
    const ret = writeBatch(pdb);
    ret.update(doc(pdb, 'families/fam1/invoices/inv1'), { status: 'returned', eventCount: 2 });
    ret.set(doc(pdb, 'families/fam1/invoices/inv1/events/e2'), {
      from: 'sent', to: 'returned', actorUid: 'p1', at: serverTimestamp(), note: 'Cuéntame más', kidId: 'k1',
    });
    await assertSucceeds(ret.commit());

    await assertSucceeds(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { description: 'Aprendí sobre dinosaurios' }));
    // matrix: activityId is only editable in draft
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { activityId: 'act1' }));
    await assertSucceeds(sendBatch(kdb, 'inv1', 'returned', 6000, 3));
  });

  it('parent counters with server timestamp and own uid', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);

    const pdb = parentCtx(env, 'p1').firestore();
    const counter = writeBatch(pdb);
    counter.update(doc(pdb, 'families/fam1/invoices/inv1'), {
      status: 'countered', eventCount: 2,
      counterOffer: { amount: 3000, note: 'Un poco menos', parentId: 'p1', at: serverTimestamp() },
    });
    counter.set(doc(pdb, 'families/fam1/invoices/inv1/events/e2'), {
      from: 'sent', to: 'countered', actorUid: 'p1', at: serverTimestamp(), kidId: 'k1',
    });
    await assertSucceeds(counter.commit());
  });

  it('no client can set status approved or write money fields', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    const pdb = parentCtx(env, 'p1').firestore();
    await assertFails(updateDoc(doc(pdb, 'families/fam1/invoices/inv1'), { status: 'approved', eventCount: 2 }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/invoices/inv1'), { netAmount: 5000 }));
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { status: 'approved', eventCount: 2 }));
  });

  it('only drafts are deletable, only by the owning kid', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await assertSucceeds(deleteDoc(doc(kdb, 'families/fam1/invoices/inv1')));
    await setDoc(doc(kdb, 'families/fam1/invoices/inv2'), draft);
    await sendBatch(kdb, 'inv2', 'draft', 5000, 1);
    await assertFails(deleteDoc(doc(kdb, 'families/fam1/invoices/inv2')));
    await assertFails(deleteDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam1/invoices/inv2')));
  });

  it('events are immutable once created', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    const events = await getDocs(query(collection(kdb, 'families/fam1/invoices/inv1/events'), where('kidId', '==', 'k1')));
    const evRef = events.docs[0]!.ref;
    await assertFails(updateDoc(evRef, { requestedAmount: 999999 }));
    await assertFails(deleteDoc(evRef));
  });

  it('kid must query invoices constrained to own kidId; broad query fails', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(getDocs(query(collection(kdb, 'families/fam1/invoices'), where('kidId', '==', 'k1'))));
    await assertFails(getDocs(collection(kdb, 'families/fam1/invoices')));
    await assertFails(getDocs(query(collection(kdb, 'families/fam1/invoices'), where('kidId', '==', 'k2'))));
    await assertSucceeds(getDocs(collection(parentCtx(env, 'p1').firestore(), 'families/fam1/invoices')));
  });
});
