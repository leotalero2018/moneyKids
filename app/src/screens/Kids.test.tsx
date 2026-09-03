import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { collection, doc, getDocsFromServer, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { Kids } from './Kids.js';

const familyId = 'famK';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('kidsparent');
  const uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
});

function renderScreen() {
  return render(<SessionProvider><Kids /></SessionProvider>);
}

describe('Kids', () => {
  it('adds a kid with zero balances', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/^nombre$/i), 'Mia');
    await userEvent.type(screen.getByLabelText(/año de nacimiento/i), '2016');
    await userEvent.click(screen.getByRole('button', { name: /agregar niño/i }));
    await waitFor(async () => {
      const kids = await getDocsFromServer(collection(db, `families/${familyId}/kids`));
      expect(kids.size).toBe(1);
      expect(kids.docs[0]!.get('spendableBalance')).toBe(0);
      expect(kids.docs[0]!.get('savingsBalance')).toBe(0);
      expect(kids.docs[0]!.get('deductionsEnabled')).toBe(false);
    });
  });

  it('lists kids with balances and toggles deductions', async () => {
    // seeded through the admin REST path: the rules require a kid to be
    // created with zero balances, and balances are server-only thereafter
    await seedDoc(`families/${familyId}/kids/k1`, {
      name: 'Mia', birthYear: 2016, deductionsEnabled: false,
      spendableBalance: 7000, savingsBalance: 2000,
    });
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    // the amount appears once the family (and so its currency) has loaded;
    // Money deliberately renders nothing until then rather than guessing USD
    await waitFor(() => expect(card).toHaveTextContent(/7[.,]?000/));
    await userEvent.click(within(card).getByRole('checkbox', { name: /deducciones/i }));
    await waitFor(async () => {
      const kids = await getDocsFromServer(collection(db, `families/${familyId}/kids`));
      expect(kids.docs[0]!.get('deductionsEnabled')).toBe(true);
    });
  });

  it('shows a join code from the callable and can revoke access', async () => {
    await seedDoc(`families/${familyId}/kids/k1`, {
      name: 'Mia', birthYear: 2016, deductionsEnabled: false,
      spendableBalance: 0, savingsBalance: 0,
    });
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.click(within(card).getByRole('button', { name: /mostrar código/i }));
    // the code is 8 characters from the join-code alphabet
    await waitFor(() => expect(within(card).getByTestId('join-code').textContent)
      .toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/));
    await userEvent.click(within(card).getByRole('button', { name: /revocar/i }));
    await waitFor(() => expect(within(card).queryByTestId('join-code')).toBeNull());
  });
});
