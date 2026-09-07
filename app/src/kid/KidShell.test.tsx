import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';
import { callables } from '../lib/callables.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { KidSessionProvider } from './KidSessionContext.js';
import { KidShell } from './KidShell.js';

const familyId = 'famShell';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidBundle().auth); });

async function seedKid(birthYear: number): Promise<string> {
  await signInTestParent('shellparent');
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
    name: 'Mia', birthYear, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/kid']}>
      <KidSessionProvider><KidShell /></KidSessionProvider>
    </MemoryRouter>,
  );
}

describe('KidShell', () => {
  it('asks for a code when no kid is signed in', async () => {
    renderShell();
    await waitFor(() => expect(screen.getByLabelText(/código/i)).toBeInTheDocument());
  });

  it('stamps the age mode on the document root so tokens can key off it', async () => {
    await signInTestKid(await seedKid(2020)); // age 6
    renderShell();
    await waitFor(() => expect(document.documentElement.dataset.ageMode).toBe('5-8'));
  });

  it('uses the older band for a teenager', async () => {
    await signInTestKid(await seedKid(2011)); // age 15
    renderShell();
    await waitFor(() => expect(document.documentElement.dataset.ageMode).toBe('12-16'));
  });
});
