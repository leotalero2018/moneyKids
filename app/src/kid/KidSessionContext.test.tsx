import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';
import { callables } from '../lib/callables.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { KidSessionProvider, useKidSession } from './KidSessionContext.js';

const familyId = 'famKS';

function Probe() {
  const s = useKidSession();
  return <div data-testid="probe">{s.status}:{s.kid?.name ?? '-'}:{s.ageMode}</div>;
}

async function makeFamilyWithKid(): Promise<string> {
  await signInTestParent('kidsession');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'Talero', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false,
    spendableBalance: 4000, savingsBalance: 1000,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

beforeEach(async () => { await clearFirestoreData(); await signOut(kidBundle().auth); });

describe('KidSessionProvider', () => {
  it('is signed-out with no kid token', async () => {
    render(<KidSessionProvider><Probe /></KidSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('signed-out'));
  });

  it('resolves family, kid, and age mode from the token claims', async () => {
    const code = await makeFamilyWithKid();
    await signInTestKid(code);
    render(<KidSessionProvider><Probe /></KidSessionProvider>);
    // claims are the only source of familyId/kidId — never the UI
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ready:Mia:8-12'));
  });

  it('honours a per-kid age-mode override', async () => {
    const code = await makeFamilyWithKid();
    await seedDoc(`families/${familyId}/kids/k1`, {
      name: 'Mia', birthYear: 2016, ageModeOverride: '5-8', deductionsEnabled: false,
      spendableBalance: 4000, savingsBalance: 1000,
    });
    await signInTestKid(code);
    render(<KidSessionProvider><Probe /></KidSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ready:Mia:5-8'));
  });
});
