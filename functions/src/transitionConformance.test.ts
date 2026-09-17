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
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.GCLOUD_PROJECT = 'money-kids-test';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8480';

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
const db = getFirestore();

const { approveInTransaction } = await import('./approval.js');

async function seedInvoice(status: InvoiceStatus): Promise<void> {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({
    name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
  });
  await db.doc('families/fam1/invoices/inv1').set({
    kidId: 'k1', activityId: null, description: 'test', photoPaths: [],
    status, requestedAmount: 5000, eventCount: 0, createdAt: FieldValue.serverTimestamp(),
  });
}

/** Attempts the server approval and reports whether it was allowed. */
async function attemptApproval(from: InvoiceStatus): Promise<boolean> {
  await seedInvoice(from);
  try {
    await approveInTransaction(db, 'fam1', 'inv1', {
      gross: 5000,
      actorUid: 'p1',
      // Pass the observed status as the expected one so this isolates the
      // state-machine check from the per-entry-point narrowing.
      expectedStatus: from as 'sent' | 'countered',
    });
    return true;
  } catch {
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
      approveInTransaction(db, 'fam1', 'inv1', { gross: 5000, actorUid: 'p1', expectedStatus: 'sent' }),
    ).rejects.toThrow(/cannot approve from status countered/);
  });

  it('records the observed status on the event, not the caller\'s expectation', async () => {
    await seedInvoice('countered');
    await approveInTransaction(db, 'fam1', 'inv1', {
      gross: 4000, actorUid: 'p1', expectedStatus: 'countered',
    });
    const event = await db.doc('families/fam1/invoices/inv1/events/e1').get();
    expect(event.get('from')).toBe('countered');
    expect(event.get('to')).toBe('approved');
  });
});
