import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, getDocFromServer, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { DeductionSettings } from './DeductionSettings.js';

const familyId = 'famD';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('dedparent');
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
  return render(<SessionProvider><DeductionSettings /></SessionProvider>);
}

describe('DeductionSettings', () => {
  it('applies the starter preset through the callable', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /paquete inicial/i }));
    await waitFor(async () => {
      const rules = (await getDocFromServer(doc(db, 'families', familyId))).get('deductionRules');
      expect(rules).toHaveLength(2);
      expect(rules[0]).toMatchObject({ basisPoints: 2000, destination: 'savings' });
      expect(rules[1]).toMatchObject({ basisPoints: 1000, destination: 'withheld' });
    }, { timeout: 5000 });
  });

  it('adds a custom rule in percent and stores basis points', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/nombre en español/i), 'Fondo');
    await userEvent.type(screen.getByLabelText(/nombre en inglés/i), 'Fund');
    await userEvent.type(screen.getByLabelText(/porcentaje/i), '7.5');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(async () => {
      const rules = (await getDocFromServer(doc(db, 'families', familyId))).get('deductionRules');
      // 7.5% is 750 basis points, not 7.5 and not 75
      expect(rules).toEqual([
        { nameEs: 'Fondo', nameEn: 'Fund', basisPoints: 750, destination: 'savings' },
      ]);
    }, { timeout: 5000 });
  });

  it('refuses a set of rules that would sum above 100% before calling', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/nombre en español/i), 'Todo');
    await userEvent.type(screen.getByLabelText(/nombre en inglés/i), 'All');
    await userEvent.type(screen.getByLabelText(/porcentaje/i), '150');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect((await getDocFromServer(doc(db, 'families', familyId))).get('deductionRules')).toEqual([]);
  });

  it('removes a rule, and clearing all rules turns deductions off', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /paquete inicial/i }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /quitar/i })).toHaveLength(2),
      { timeout: 5000 });
    // re-query between clicks: the list re-renders, so a node captured up
    // front is detached by the time the second click lands
    await userEvent.click(screen.getAllByRole('button', { name: /quitar/i })[0]!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /quitar/i })).toHaveLength(1),
      { timeout: 5000 });
    await userEvent.click(screen.getAllByRole('button', { name: /quitar/i })[0]!);
    await waitFor(async () => {
      expect((await getDocFromServer(doc(db, 'families', familyId))).get('deductionRules')).toEqual([]);
    }, { timeout: 5000 });
  });
});
