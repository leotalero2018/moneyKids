import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../../test/emulator.js';
import { KidSessionProvider } from '../../kid/KidSessionContext.js';
import { KidInvoices } from './KidInvoices.js';

const familyId = 'famHist';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidBundle().auth); });

async function seedHistory(birthYear: number): Promise<void> {
  await signInTestParent('histparent');
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
    name: 'Mia', birthYear, deductionsEnabled: true,
    spendableBalance: 4000, savingsBalance: 1000,
  });
  await seedDoc(`families/${familyId}/kids/k2`, {
    name: 'Sib', birthYear: 2014, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  await seedDoc(`families/${familyId}/invoices/appr1`, {
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'approved', requestedAmount: 5000, approvedAmount: 5000, netAmount: 4000,
    deductions: [{
      nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000,
      destination: 'savings', amount: 1000,
    }],
    eventCount: 2, createdAt: new Date('2026-09-01'),
  });
  await seedDoc(`families/${familyId}/invoices/sent1`, {
    kidId: 'k1', activityId: null, description: 'Ordené mi cuarto', photoPaths: [],
    status: 'sent', requestedAmount: 3000, eventCount: 1, createdAt: new Date('2026-09-02'),
  });
  // a sibling's invoice: the kid-constrained query must never surface it
  await seedDoc(`families/${familyId}/invoices/sib1`, {
    kidId: 'k2', activityId: null, description: 'Secreto de mi hermano', photoPaths: [],
    status: 'sent', requestedAmount: 9000, eventCount: 1, createdAt: new Date('2026-09-03'),
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  await signInTestKid(data.code);
}

function renderHistory() {
  return render(
    <MemoryRouter>
      <KidSessionProvider><KidInvoices /></KidSessionProvider>
    </MemoryRouter>,
  );
}

describe('KidInvoices', () => {
  it('lists only this kid’s invoices, newest first', async () => {
    await seedHistory(2016);
    renderHistory();
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ordené mi cuarto'); // Sep 2
    expect(items[1]).toHaveTextContent('Leí un libro');     // Sep 1
    expect(screen.queryByText(/Secreto de mi hermano/)).toBeNull();
  });

  it('shows the pay stub on an approved invoice', async () => {
    await seedHistory(2016);
    renderHistory();
    const stub = await screen.findByTestId('paystub-appr1');
    await waitFor(() => expect(stub).toHaveTextContent(/5[.,]?000/)); // gross
    expect(stub).toHaveTextContent(/Ahorro/);    // the line item, in Spanish
    expect(stub).toHaveTextContent(/1[.,]?000/); // withheld to savings
    expect(stub).toHaveTextContent(/4[.,]?000/); // net
  });

  it('shows earnings stats only in the oldest mode', async () => {
    await seedHistory(2011); // age 15
    renderHistory();
    await waitFor(() => expect(screen.getByTestId('stats')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('stats')).toHaveTextContent(/5[.,]?000/));
  });

  it('hides stats for younger kids', async () => {
    await seedHistory(2020); // age 6
    renderHistory();
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('stats')).toBeNull();
  });
});
