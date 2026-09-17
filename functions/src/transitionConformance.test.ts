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
import { beforeAll, describe, expect, it } from 'vitest';

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

const { approveInTransaction } = await import('./approval.js');

// A family id of its own: vitest runs these files serially
// (fileParallelism: false), but sharing 'fam1' with the other suites would
// make that config load-bearing for correctness rather than just for speed.
async function seedInvoice(status: InvoiceStatus): Promise<void> {
  await db.recursiveDelete(db.collection('families').doc('famTransitions'));
  await db.doc('families/famTransitions').set({ name: 'T', language: 'es', currency: 'COP', deductionRules: [] });
  await db.doc('families/famTransitions/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/famTransitions/kids/k1').set({
    name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
  });
  await db.doc('families/famTransitions/invoices/inv1').set({
    kidId: 'k1', activityId: null, description: 'test', photoPaths: [],
    status, requestedAmount: 5000, eventCount: 0, createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Attempts the server approval and reports whether it was allowed.
 *
 * A bare `catch { return false }` would make the three refusal cases vacuous:
 * a seeding typo, a missing kid doc or a crash in computeDeductions would all
 * satisfy them while proving nothing. So a refusal only counts if it is the
 * state machine refusing.
 */
async function attemptApproval(from: InvoiceStatus): Promise<boolean> {
  await seedInvoice(from);
  try {
    await approveInTransaction(db, 'famTransitions', 'inv1', {
      gross: 5000,
      actorUid: 'p1',
      // Pass the observed status as the expected one so this isolates the
      // state-machine check from the per-entry-point narrowing.
      expectedStatus: from as 'sent' | 'countered',
    });
    return true;
  } catch (e) {
    expect((e as { code?: string }).code).toBe('failed-precondition');
    expect((e as Error).message).toMatch(/cannot approve from status/);
    return false;
  }
}

describe('callables conform to the shared invoice state machine', () => {
  beforeAll(() => {
    // A table with no server transitions would make every assertion below
    // vacuous, so fail loudly rather than passing on an empty matrix.
    const serverTransitions = INVOICE_STATUSES.filter((s) => canTransition(s, 'approved', 'server'));
    expect(serverTransitions.length).toBeGreaterThan(0);
  });

  for (const from of INVOICE_STATUSES) {
    const allowed = canTransition(from, 'approved', 'server');
    it(`${allowed ? 'approves' : 'refuses to approve'} an invoice in status "${from}"`, async () => {
      expect(await attemptApproval(from)).toBe(allowed);
    });
  }

  it('keeps each entry point narrow: approveInvoice will not take a countered invoice', async () => {
    // Both sent->approved and countered->approved are legal for the server, so
    // the state machine alone would let approveInvoice settle a countered
    // invoice at the amount the kid originally asked for, ignoring the
    // parent's counter-offer.
    await seedInvoice('countered');
    await expect(
      approveInTransaction(db, 'famTransitions', 'inv1', { gross: 5000, actorUid: 'p1', expectedStatus: 'sent' }),
    ).rejects.toThrow(/this action cannot settle an invoice in status countered/);
  });

  it('records the observed status on the event, not the caller\'s expectation', async () => {
    await seedInvoice('countered');
    await approveInTransaction(db, 'famTransitions', 'inv1', {
      gross: 4000, actorUid: 'p1', expectedStatus: 'countered',
    });
    const event = await db.doc('families/famTransitions/invoices/inv1/events/e1').get();
    expect(event.get('from')).toBe('countered');
    expect(event.get('to')).toBe('approved');
  });
});
