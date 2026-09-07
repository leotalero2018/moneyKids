import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { doc, getDocFromServer, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../../test/emulator.js';
import { KidSessionProvider } from '../../kid/KidSessionContext.js';
import { InvoiceNegotiation } from './InvoiceNegotiation.js';

const familyId = 'famNeg';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidBundle().auth); });

async function seedFamily(): Promise<string> {
  await signInTestParent('negparent');
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
  return data.code;
}

async function seedCountered(counterAmount: number): Promise<void> {
  const code = await seedFamily();
  await seedDoc(`families/${familyId}/invoices/inv1`, {
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'countered', requestedAmount: 8000, eventCount: 2, createdAt: new Date(),
    counterOffer: {
      amount: counterAmount, note: 'un poco menos',
      parentId: parentFb.auth.currentUser!.uid, at: new Date(),
    },
  });
  await signInTestKid(code);
}

function renderNegotiation() {
  return render(
    <MemoryRouter initialEntries={['/kid/invoice/inv1']}>
      <KidSessionProvider>
        <Routes>
          <Route path="/kid/invoice/:invoiceId" element={<InvoiceNegotiation />} />
        </Routes>
      </KidSessionProvider>
    </MemoryRouter>,
  );
}

describe('InvoiceNegotiation', () => {
  it('shows both amounts so the choice is legible', async () => {
    await seedCountered(5000);
    renderNegotiation();
    await waitFor(() => expect(screen.getByTestId('asked')).toHaveTextContent(/8[.,]?000/));
    expect(screen.getByTestId('offered')).toHaveTextContent(/5[.,]?000/);
    expect(screen.getByText(/un poco menos/)).toBeInTheDocument();
  });

  it('accepting approves at the parent’s amount and credits the balance', async () => {
    await seedCountered(5000);
    renderNegotiation();
    await userEvent.click(await screen.findByRole('button', { name: /aceptar/i }));
    await waitFor(async () => {
      const snap = await getDocFromServer(doc(kidBundle().db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('approved');
      // strictly the counter amount, never the kid's original ask
      expect(snap.get('approvedAmount')).toBe(5000);
    }, { timeout: 5000 });
    expect((await getDocFromServer(doc(kidBundle().db, `families/${familyId}/kids/k1`)))
      .get('spendableBalance')).toBe(5000);
    expect(await screen.findByTestId('celebrate')).toBeInTheDocument();
  });

  it('revising and resending keeps the kid’s own price', async () => {
    await seedCountered(5000);
    renderNegotiation();
    await userEvent.clear(await screen.findByLabelText(/explica/i));
    await userEvent.type(screen.getByLabelText(/explica/i), 'Me tomó tres días');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(async () => {
      const snap = await getDocFromServer(doc(kidBundle().db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('sent');
      expect(snap.get('description')).toBe('Me tomó tres días');
      expect(snap.get('requestedAmount')).toBe(8000); // unchanged ask
    }, { timeout: 5000 });
  });

  it('a returned invoice offers edit-and-resend, with nothing to accept', async () => {
    // the history screen links draft, returned AND countered invoices here,
    // so this screen is where a kid finishes any unsent one
    const code = await seedFamily();
    await seedDoc(`families/${familyId}/invoices/inv1`, {
      kidId: 'k1', activityId: null, description: 'muy corto', photoPaths: [],
      status: 'returned', requestedAmount: 4000, eventCount: 2, createdAt: new Date(),
    });
    await signInTestKid(code);
    renderNegotiation();
    await waitFor(() => expect(screen.getByTestId('asked')).toHaveTextContent(/4[.,]?000/));
    expect(screen.queryByRole('button', { name: /aceptar/i })).toBeNull();
    expect(screen.queryByTestId('offered')).toBeNull();

    await userEvent.clear(screen.getByLabelText(/explica/i));
    await userEvent.type(screen.getByLabelText(/explica/i), 'Ahora con detalles');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(async () => {
      const snap = await getDocFromServer(doc(kidBundle().db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('sent');
      expect(snap.get('description')).toBe('Ahora con detalles');
    }, { timeout: 5000 });
  });
});
