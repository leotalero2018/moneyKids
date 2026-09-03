import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { doc, getDocFromServer, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { Inbox } from './Inbox.js';
import { InvoiceDetail } from './InvoiceDetail.js';

const familyId = 'famB';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('inboxparent');
  const uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  // a client may only create a family with NO deduction rules — they are
  // callable-only — so the rules are seeded through the admin path below
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}`, {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid,
    deductionRules: [
      { nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' },
    ],
  });
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: true,
    spendableBalance: 0, savingsBalance: 0,
  });
  await seedDoc(`families/${familyId}/invoices/inv1`, {
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'sent', requestedAmount: 5000, eventCount: 1, createdAt: new Date(),
  });
});

function renderAt(path: string) {
  return render(
    <SessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/invoice/:invoiceId" element={<InvoiceDetail />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe('Inbox', () => {
  it('lists pending invoices with the kid name and amount', async () => {
    renderAt('/inbox');
    const item = await screen.findByRole('link', { name: /Mia/ });
    await waitFor(() => expect(item).toHaveTextContent(/5[.,]?000/));
  });
  it('says so when nothing is pending', async () => {
    await seedDoc(`families/${familyId}/invoices/inv1`, {
      kidId: 'k1', activityId: null, description: 'x', photoPaths: [],
      status: 'approved', requestedAmount: 5000, approvedAmount: 5000, netAmount: 5000,
      deductions: [], eventCount: 2, createdAt: new Date(),
    });
    renderAt('/inbox');
    expect(await screen.findByText(/no hay facturas/i)).toBeInTheDocument();
  });
});

describe('InvoiceDetail', () => {
  it('approves through the callable, showing the deduction breakdown after', async () => {
    renderAt('/invoice/inv1');
    await userEvent.click(await screen.findByRole('button', { name: /^aprobar$/i }));
    await waitFor(async () => {
      const snap = await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('approved');
      expect(snap.get('netAmount')).toBe(4000); // 5000 less 20% savings
    }, { timeout: 5000 });
    // the credit and the kid balance are the callable's job, not the client's
    const credit = await getDocFromServer(doc(db, `families/${familyId}/ledger/credit_inv1`));
    expect(credit.get('amount')).toBe(4000);
    expect((await getDocFromServer(doc(db, `families/${familyId}/kids/k1`))).get('savingsBalance'))
      .toBe(1000);
  });

  it('returns with feedback', async () => {
    renderAt('/invoice/inv1');
    await userEvent.type(await screen.findByLabelText(/mensaje/i), 'Cuéntame más');
    await userEvent.click(screen.getByRole('button', { name: /devolver/i }));
    await waitFor(async () => {
      expect((await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1`))).get('status'))
        .toBe('returned');
    }, { timeout: 5000 });
  });

  it('counters with a different amount typed in major units', async () => {
    renderAt('/invoice/inv1');
    await userEvent.type(await screen.findByLabelText(/otro monto/i), '3000');
    await userEvent.click(screen.getByRole('button', { name: /contraofertar/i }));
    await waitFor(async () => {
      const snap = await getDocFromServer(doc(db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('countered');
      // COP has 0 minor digits, so 3000 typed is 3000 minor units
      expect(snap.get('counterOffer').amount).toBe(3000);
    }, { timeout: 5000 });
  });

  it('shows an error when the callable rejects, without changing the invoice', async () => {
    // a pending invoice pointing at a kid who does not exist: the review
    // actions are on screen, and the approval callable rejects with not-found.
    // (A non-pending invoice would not do — the UI hides the actions entirely,
    // which is why the error path needs a genuinely failing approval.)
    await seedDoc(`families/${familyId}/invoices/inv2`, {
      kidId: 'ghost', activityId: null, description: 'Sin niño', photoPaths: [],
      status: 'sent', requestedAmount: 5000, eventCount: 1, createdAt: new Date(),
    });
    renderAt('/invoice/inv2');
    await userEvent.click(await screen.findByRole('button', { name: /^aprobar$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 5000 });
    expect((await getDocFromServer(doc(db, `families/${familyId}/invoices/inv2`))).get('status'))
      .toBe('sent');
  });
});
