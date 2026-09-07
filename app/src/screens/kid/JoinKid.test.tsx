import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent } from '../../test/emulator.js';
import { JoinKid } from './JoinKid.js';

const familyId = 'famJK';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidBundle().auth); });

async function joinCode(): Promise<string> {
  await signInTestParent('joinkidparent');
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

describe('JoinKid', () => {
  it('signs the kid in on the kid instance, leaving the parent session alone', async () => {
    const code = await joinCode();
    const parentUid = parentFb.auth.currentUser!.uid;
    render(<JoinKid />);
    await userEvent.type(screen.getByLabelText(/código/i), code.toLowerCase());
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    await waitFor(() => expect(kidBundle().auth.currentUser).not.toBeNull(), { timeout: 5000 });
    // the uid is family-namespaced, and the claims carry the identity
    expect(kidBundle().auth.currentUser!.uid).toBe(`kid_${familyId}_k1`);
    const claims = (await kidBundle().auth.currentUser!.getIdTokenResult()).claims;
    expect(claims.role).toBe('kid');
    expect(claims.familyId).toBe(familyId);
    expect(claims.kidId).toBe('k1');
    // and the parent is still signed in on the other instance
    expect(parentFb.auth.currentUser!.uid).toBe(parentUid);
  });

  it('shows one error for a wrong, used, or malformed code', async () => {
    render(<JoinKid />);
    for (const bad of ['ABCD2345', 'nope', '']) {
      await userEvent.clear(screen.getByLabelText(/código/i));
      if (bad) await userEvent.type(screen.getByLabelText(/código/i), bad);
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    }
    expect(kidBundle().auth.currentUser).toBeNull();
  });
});
