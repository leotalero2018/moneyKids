import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { collection, doc, getDocsFromServer, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { Activities } from './Activities.js';

const familyId = 'famA';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('actparent');
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
  return render(<SessionProvider><Activities /></SessionProvider>);
}

describe('Activities', () => {
  it('seeds the starter catalog and shows it grouped by pillar', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /catálogo/i }));
    await waitFor(async () => {
      const activities = await getDocsFromServer(collection(db, `families/${familyId}/activities`));
      expect(activities.size).toBe(8);
      // every seeded doc must satisfy the activity rules, including attribution
      expect(activities.docs[0]!.get('createdBy')).toBe(auth.currentUser!.uid);
      expect(activities.docs[0]!.get('active')).toBe(true);
    });
    expect(await screen.findByRole('heading', { name: /Lee un libro/ })).toBeInTheDocument();
  });

  it('creates a custom activity and deactivates it', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/título/i), 'Ordena tu cuarto');
    await userEvent.type(screen.getByLabelText(/precio/i), '2000');
    await userEvent.selectOptions(screen.getByLabelText(/categoría/i), 'help');
    await userEvent.click(screen.getByRole('button', { name: /crear actividad/i }));

    const card = await screen.findByRole('group', { name: /Ordena tu cuarto/ });
    await userEvent.click(within(card).getByRole('checkbox', { name: /activa/i }));
    // the default 1s waitFor is tight for a write round trip when the whole
    // suite is running against one emulator
    await waitFor(async () => {
      const activities = await getDocsFromServer(collection(db, `families/${familyId}/activities`));
      expect(activities.docs[0]!.get('active')).toBe(false);
      // attribution survives the edit unchanged
      expect(activities.docs[0]!.get('createdBy')).toBe(auth.currentUser!.uid);
    }, { timeout: 5000 });
  });

  it('rejects a title longer than the rules allow, before writing', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/título/i), 'x'.repeat(81));
    await userEvent.type(screen.getByLabelText(/precio/i), '1000');
    await userEvent.click(screen.getByRole('button', { name: /crear actividad/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const activities = await getDocsFromServer(collection(db, `families/${familyId}/activities`));
    expect(activities.size).toBe(0);
  });
});
