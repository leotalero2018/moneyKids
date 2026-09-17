// The invoice state machine lives in @money-kids/shared and is enforced in
// three places: the callables, the app, and these rules. The rules express it
// as literal status comparisons, so nothing structurally ties them to the
// table — this test does, by driving every assertion from the table itself.
//
// Adding a transition to shared without updating the rules fails here, and so
// does a rule that permits a transition the table does not.
//
// One honest limit: assertFails cannot distinguish "denied by the status-pair
// rule" from "denied by some other validation on the same write". A rule that
// wrongly permitted draft->countered but happened to trip on counterOffer
// field validation would still pass. The suite proves the rules deny
// everything the table denies, not always for the reason intended.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { INVOICE_STATUSES, TRANSITIONS, canTransition, type Actor, type InvoiceStatus } from '@money-kids/shared';
import type { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kidCtx, parentCtx, seed, setupTestEnv } from './helpers.js';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/famTransitions'), {
      name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [],
    });
    await setDoc(doc(db, 'families/famTransitions/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/famTransitions/kids/k1'), {
      name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
    });
  });
});

async function seedInvoice(status: InvoiceStatus): Promise<void> {
  await seed(env, async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'families/famTransitions/invoices/inv1'), {
      kidId: 'k1', activityId: null, description: 'test', photoPaths: [],
      status, requestedAmount: 5000, eventCount: 0, createdAt: serverTimestamp(),
    });
  });
}

/**
 * Attempts `from -> to` as `actor`, shaped the way the app would write it: the
 * invoice update and its event doc in one batch, which is what the rules
 * require. Returns nothing; the caller asserts on the promise.
 */
function attempt(ctx: RulesTestContext, actor: Actor, from: InvoiceStatus, to: InvoiceStatus): Promise<void> {
  const db = ctx.firestore();
  const batch = writeBatch(db);
  const update: Record<string, unknown> = { status: to, eventCount: 1 };
  // counterOffer is a validated map, not a scalar: the kid reads it as the
  // amount they may accept, so the rules pin its shape
  if (to === 'countered') {
    update.counterOffer = { amount: 4000, parentId: 'p1', at: serverTimestamp() };
  }
  batch.update(doc(db, 'families/famTransitions/invoices/inv1'), update);

  const event: Record<string, unknown> = {
    from, to, actorUid: actor === 'kid' ? 'kid_famTransitions_k1' : 'p1', at: serverTimestamp(), kidId: 'k1',
  };
  // requestedAmount belongs to 'sent' events only, and must match the invoice
  if (to === 'sent') event.requestedAmount = 5000;
  batch.set(doc(db, 'families/famTransitions/invoices/inv1/events/e1'), event);
  return batch.commit();
}

const ctxFor = (actor: Actor) => (actor === 'kid' ? kidCtx(env, 'famTransitions', 'k1') : parentCtx(env, 'p1'));

describe('firestore rules conform to the shared invoice state machine', () => {
  it('has transitions to check, so the matrix below is not vacuous', () => {
    expect(TRANSITIONS.length).toBeGreaterThan(0);
    expect(TRANSITIONS.some((t) => t.actors.includes('kid'))).toBe(true);
    expect(TRANSITIONS.some((t) => t.actors.includes('parent'))).toBe(true);
  });

  // Only kid and parent write through the rules; server transitions go through
  // callables, which bypass rules and are covered in functions/.
  for (const actor of ['kid', 'parent'] as const) {
    for (const from of INVOICE_STATUSES) {
      for (const to of INVOICE_STATUSES) {
        if (from === to) continue; // the rules reject from == to outright
        const allowed = canTransition(from, to, actor);
        it(`${actor} ${allowed ? 'may' : 'may not'} move an invoice ${from} -> ${to}`, async () => {
          await seedInvoice(from);
          const run = attempt(ctxFor(actor), actor, from, to);
          await (allowed ? assertSucceeds(run) : assertFails(run));
        });
      }
    }
  }
});
