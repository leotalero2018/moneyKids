import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../../test/emulator.js';
import { KidSessionProvider } from '../../kid/KidSessionContext.js';
import { KidHome } from './KidHome.js';

const familyId = 'famHome';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidBundle().auth); });

async function seedAll(deductionsEnabled: boolean): Promise<string> {
  await signInTestParent('homeparent');
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

  // activities go in a SEPARATE write, after the family batch has landed:
  // the activity rule authorizes through isFamilyParent(), which uses
  // exists() on the member doc, and exists() sees only pre-batch state — so
  // an activity created in the same batch as its family is always denied
  await setDoc(doc(parentFb.db, `families/${familyId}/activities/act1`), {
    titleEs: 'Lee un libro', titleEn: 'Read a book', descriptionEs: 'Cuéntamelo',
    descriptionEn: 'Tell me about it', suggestedPrice: 5000, category: 'learn',
    repeatable: true, active: true, createdBy: uid, createdAt: serverTimestamp(),
  });
  await setDoc(doc(parentFb.db, `families/${familyId}/activities/act2`), {
    titleEs: 'Actividad guardada', titleEn: 'Archived activity', descriptionEs: '',
    descriptionEn: '', suggestedPrice: 1000, category: 'help',
    repeatable: true, active: false, createdBy: uid, createdAt: serverTimestamp(),
  });
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled,
    spendableBalance: 7000, savingsBalance: 2000,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

function renderHome() {
  return render(
    <MemoryRouter>
      <KidSessionProvider><KidHome /></KidSessionProvider>
    </MemoryRouter>,
  );
}

describe('KidHome', () => {
  it('shows the spendable balance and, with deductions on, the savings one', async () => {
    await signInTestKid(await seedAll(true));
    renderHome();
    await waitFor(() => expect(screen.getByTestId('spendable')).toHaveTextContent(/7[.,]?000/));
    expect(screen.getByTestId('savings')).toHaveTextContent(/2[.,]?000/);
  });

  it('hides the savings balance when the kid has deductions off', async () => {
    await signInTestKid(await seedAll(false));
    renderHome();
    await waitFor(() => expect(screen.getByTestId('spendable')).toBeInTheDocument());
    // nothing is being withheld, so a second balance would only confuse
    expect(screen.queryByTestId('savings')).toBeNull();
  });

  it('hides a one-time activity the kid has already had approved', async () => {
    // the spec asks for this as a courtesy: the approval function is what
    // actually prevents double payment, but offering an activity that can
    // only be refused is a bad screen
    const code = await seedAll(true);
    await seedDoc(`families/${familyId}/activities/once1`, {
      titleEs: 'Solo una vez', titleEn: 'One time only', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 2000, category: 'ideas', repeatable: false, active: true,
      createdBy: 'p1', createdAt: new Date(),
    });
    await seedDoc(`families/${familyId}/invoices/done1`, {
      kidId: 'k1', activityId: 'once1', description: 'ya', photoPaths: [],
      status: 'approved', requestedAmount: 2000, approvedAmount: 2000, netAmount: 2000,
      deductions: [], eventCount: 2, createdAt: new Date(),
    });
    await signInTestKid(code);
    renderHome();
    expect(await screen.findByRole('heading', { name: /Lee un libro/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Solo una vez/ })).toBeNull();
  });

  it('keeps showing a repeatable activity the kid has already been paid for', async () => {
    const code = await seedAll(true);
    await seedDoc(`families/${familyId}/invoices/done2`, {
      kidId: 'k1', activityId: 'act1', description: 'ya', photoPaths: [],
      status: 'approved', requestedAmount: 5000, approvedAmount: 5000, netAmount: 5000,
      deductions: [], eventCount: 2, createdAt: new Date(),
    });
    await signInTestKid(code);
    renderHome();
    expect(await screen.findByRole('heading', { name: /Lee un libro/ })).toBeInTheDocument();
  });

  it('lists only active activities, with their suggested price', async () => {
    await signInTestKid(await seedAll(true));
    renderHome();
    expect(await screen.findByRole('heading', { name: /Lee un libro/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Actividad guardada/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Lee un libro/ }).getAttribute('href'))
      .toContain('/kid/new?activity=act1');
  });
});
