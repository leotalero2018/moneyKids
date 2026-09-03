import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { collection, doc, getDocFromServer, getDocsFromServer, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { Payouts } from './Payouts.js';

const familyId = 'famP';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('payparent');
  const uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: true,
    spendableBalance: 7000, savingsBalance: 2000,
  });
});

function renderScreen() {
  return render(<SessionProvider><Payouts /></SessionProvider>);
}

describe('Payouts', () => {
  it('records a payout through the callable and debits the balance', async () => {
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.type(within(card).getByLabelText(/monto a pagar/i), '3000');
    await userEvent.click(within(card).getByRole('button', { name: /registrar pago/i }));
    await waitFor(async () => {
      expect((await getDocFromServer(doc(db, `families/${familyId}/kids/k1`))).get('spendableBalance'))
        .toBe(4000);
    }, { timeout: 5000 });
    const ledger = await getDocsFromServer(collection(db, `families/${familyId}/ledger`));
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0]!.get('type')).toBe('payout');
    expect(ledger.docs[0]!.get('balance')).toBe('spendable');
  });

  it('pays out of savings when that balance is chosen', async () => {
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.selectOptions(within(card).getByLabelText(/de dónde/i), 'savings');
    await userEvent.type(within(card).getByLabelText(/monto a pagar/i), '2000');
    await userEvent.click(within(card).getByRole('button', { name: /registrar pago/i }));
    await waitFor(async () => {
      expect((await getDocFromServer(doc(db, `families/${familyId}/kids/k1`))).get('savingsBalance'))
        .toBe(0);
    }, { timeout: 5000 });
  });

  it('shows the callable error when the payout exceeds the balance', async () => {
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.type(within(card).getByLabelText(/monto a pagar/i), '9999');
    await userEvent.click(within(card).getByRole('button', { name: /registrar pago/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 5000 });
    expect((await getDocFromServer(doc(db, `families/${familyId}/kids/k1`))).get('spendableBalance'))
      .toBe(7000);
  });

  it('rejects an unparseable amount without calling the function', async () => {
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.type(within(card).getByLabelText(/monto a pagar/i), 'abc');
    await userEvent.click(within(card).getByRole('button', { name: /registrar pago/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect((await getDocsFromServer(collection(db, `families/${familyId}/ledger`))).size).toBe(0);
  });
});
