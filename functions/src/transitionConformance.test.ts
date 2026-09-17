// The invoice state machine lives in @money-kids/shared, but it is enforced in
// three places: the Firestore rules, the callables, and the app. Callables
// bypass rules entirely and are the only path that credits a balance, so if
// they drift from the table, an invalid transition ships while the rules tests
// stay green.
//
// These tests are driven by the table itself rather than restating it, so
// adding or removing a transition in shared changes what is asserted here.
import { FieldValue } from 'firebase-admin/firestore';
import { INVOICE_STATUSES, canTransition, type InvoiceStatus } from '@money-kids/shared';
import { describe, expect, it } from 'vitest';

process.env.GCLOUD_PROJECT = 'money-kids-test';
// No default host: this suite runs under `npm run test:functions`, which wraps
// it in firebase emulators:exec and sets this. Hardcoding a fallback would
// duplicate the port from firebase.json and let a missing emulator hang
// instead of failing.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is not set — run this via `npm run test:functions`');
}

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
const db = getFirestore();

const FAMILY = 'famTransitions';

const { approveInvoiceCore, SERVER_APPROVAL_ENTRY_POINTS } = await import('./approval.js');
const { acceptCounterOfferCore } = await import('./counterOffer.js');

// A family id of its own: vitest runs these files serially
// (fileParallelism: false), but sharing 'fam1' with the other suites would
// make that config load-bearing for correctness rather than just for speed.
async function seedInvoice(status: InvoiceStatus): Promise<void> {
  await db.recursiveDelete(db.collection('families').doc(FAMILY));
  await db.doc(`families/${FAMILY}`).set({ name: 'T', language: 'es', currency: 'COP', deductionRules: [] });
  await db.doc(`families/${FAMILY}/members/p1`).set({ role: 'parent', displayName: 'Leo' });
  await db.doc(`families/${FAMILY}/kids/k1`).set({
    name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
  });
  await db.doc(`families/${FAMILY}/invoices/inv1`).set({
    kidId: 'k1', activityId: null, description: 'test', photoPaths: [],
    status, requestedAmount: 5000, eventCount: 0, createdAt: FieldValue.serverTimestamp(),
    // Seeded on every invoice regardless of status so that acceptCounterOffer
    // can only ever refuse because of the status — otherwise a refusal could
    // be "no counter-offer to accept", and the matrix would pass for the wrong
    // reason on four of the five statuses.
    counterOffer: { amount: 4000, parentId: 'p1', at: FieldValue.serverTimestamp() },
  });
}

const ENTRY_POINTS = {
  approveInvoice: (auth: unknown) =>
    approveInvoiceCore(db, auth as never, { familyId: FAMILY, invoiceId: 'inv1' }),
  acceptCounterOffer: (auth: unknown) =>
    acceptCounterOfferCore(db, auth as never, { familyId: FAMILY, invoiceId: 'inv1' }),
} as const;

const parentAuth = { uid: 'p1', token: { role: 'parent' } };
const kidAuth = { uid: 'kid_x', token: { role: 'kid', familyId: FAMILY, kidId: 'k1' } };
const AUTH_FOR: Record<keyof typeof ENTRY_POINTS, unknown> = {
  approveInvoice: parentAuth,
  acceptCounterOffer: kidAuth,
};

/**
 * Runs a real entry point and reports whether it settled the invoice.
 *
 * Deliberately goes through the exported callable cores rather than
 * approveInTransaction with a synthetic expectedStatus: a fabricated argument
 * would let this suite report conformance the deployed callables do not have.
 * Adding `returned -> approved` to the table would "pass" against the helper
 * while approveInvoice still refused.
 *
 * A bare `catch { return false }` would make the refusal cases vacuous — a
 * seeding typo or a crash in computeDeductions would satisfy them — so a
 * refusal only counts if it is a precondition being enforced.
 */
async function attempt(entry: keyof typeof ENTRY_POINTS, from: InvoiceStatus): Promise<boolean> {
  await seedInvoice(from);
  try {
    await ENTRY_POINTS[entry](AUTH_FOR[entry]);
    return true;
  } catch (e) {
    expect((e as { code?: string }).code).toBe('failed-precondition');
    expect((e as Error).message).toMatch(/cannot approve from status|cannot settle an invoice in status/);
    return false;
  }
}

describe('callables conform to the shared invoice state machine', () => {
  it('exercises every entry point the production map declares', () => {
    // The matrix iterates this file's ENTRY_POINTS while the equality check
    // below reads the production map. Without this, adding a third approving
    // callable to production and forgetting it here would leave the equality
    // check passing while the matrix never exercised it.
    expect(Object.keys(ENTRY_POINTS).sort()).toEqual(Object.keys(SERVER_APPROVAL_ENTRY_POINTS).sort());
  });

  it('the entry points cover exactly the transitions the table permits the server', () => {
    // This is the assertion that catches drift in BOTH directions. Add
    // `returned -> approved` to the table and no entry point settles it, so
    // the sets differ and this fails — which testing the shared helper with a
    // fabricated expectedStatus could never catch.
    const settledByCallables = new Set<string>(Object.values(SERVER_APPROVAL_ENTRY_POINTS));
    const allowedByTable = new Set(INVOICE_STATUSES.filter((s) => canTransition(s, 'approved', 'server')));
    expect([...settledByCallables].sort()).toEqual([...allowedByTable].sort());
    expect(allowedByTable.size).toBeGreaterThan(0);
  });

  for (const entry of Object.keys(ENTRY_POINTS) as (keyof typeof ENTRY_POINTS)[]) {
    const settles = SERVER_APPROVAL_ENTRY_POINTS[entry];
    for (const from of INVOICE_STATUSES) {
      const allowed = from === settles && canTransition(from, 'approved', 'server');
      it(`${entry} ${allowed ? 'settles' : 'refuses'} an invoice in status "${from}"`, async () => {
        expect(await attempt(entry, from)).toBe(allowed);
      });
    }
  }

  it('writes an audit event naming the transition that happened', async () => {
    // Not framed as "observed status, not the caller's expectation": the
    // `from !== expectedStatus` precondition makes those provably equal, so no
    // test can distinguish the two implementations. What is worth pinning is
    // that the immutable audit doc names the real transition.
    await seedInvoice('countered');
    await ENTRY_POINTS.acceptCounterOffer(kidAuth);
    const event = await db.doc(`families/${FAMILY}/invoices/inv1/events/e1`).get();
    expect(event.get('from')).toBe('countered');
    expect(event.get('to')).toBe('approved');
  });

  // The matrix above proves each entry point settles the right *statuses*. The
  // reason the narrowing check exists is an amount: without it approveInvoice
  // would settle a countered invoice at the figure the kid originally asked
  // for, ignoring the parent's counter-offer. Seeds are requestedAmount 5000
  // and counterOffer.amount 4000, so the two are distinguishable.
  it('acceptCounterOffer credits the counter-offer amount, not the requested one', async () => {
    await seedInvoice('countered');
    const { approvedAmount } = await ENTRY_POINTS.acceptCounterOffer(kidAuth);
    expect(approvedAmount).toBe(4000);
    const kid = await db.doc(`families/${FAMILY}/kids/k1`).get();
    expect(kid.get('spendableBalance')).toBe(4000);
  });

  it('approveInvoice credits the requested amount on a sent invoice', async () => {
    await seedInvoice('sent');
    const { approvedAmount } = await ENTRY_POINTS.approveInvoice(parentAuth);
    expect(approvedAmount).toBe(5000);
    const kid = await db.doc(`families/${FAMILY}/kids/k1`).get();
    expect(kid.get('spendableBalance')).toBe(5000);
  });

  it('refuses rather than overpaying when a countered invoice reaches approveInvoice', async () => {
    // The scenario the narrowing check is for: the kid asked 5000, the parent
    // countered at 4000. Settling this through approveInvoice would credit
    // 5000 and silently discard the counter-offer.
    await seedInvoice('countered');
    await expect(ENTRY_POINTS.approveInvoice(parentAuth)).rejects.toThrow(
      /cannot settle an invoice in status countered/,
    );
    const kid = await db.doc(`families/${FAMILY}/kids/k1`).get();
    expect(kid.get('spendableBalance')).toBe(0);
  });
});
