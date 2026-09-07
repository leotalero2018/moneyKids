import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  collection, doc, getDocsFromServer, query, serverTimestamp, setDoc, where, writeBatch,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../../test/emulator.js';
import { KidSessionProvider } from '../../kid/KidSessionContext.js';
import { NewInvoice } from './NewInvoice.js';

const familyId = 'famNew';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidBundle().auth); });

async function seedKid(birthYear: number): Promise<string> {
  await signInTestParent('newparent');
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
  // separate write: isFamilyParent() uses exists(), which cannot see a member
  // doc created in the same batch
  await setDoc(doc(parentFb.db, `families/${familyId}/activities/act1`), {
    titleEs: 'Lee un libro', titleEn: 'Read a book', descriptionEs: '', descriptionEn: '',
    suggestedPrice: 5000, category: 'learn', repeatable: true, active: true,
    createdBy: uid, createdAt: serverTimestamp(),
  });
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

function renderNew(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/kid/new${search}`]}>
      <KidSessionProvider><NewInvoice /></KidSessionProvider>
    </MemoryRouter>,
  );
}

async function invoices() {
  // constrained by kidId: rules do not filter queries, so an unconstrained
  // list from a kid session is denied outright rather than trimmed
  return getDocsFromServer(query(
    collection(kidBundle().db, `families/${familyId}/invoices`),
    where('kidId', '==', 'k1'),
  ));
}

describe('NewInvoice at 8-12', () => {
  it('creates a draft from a free-form idea with the kid’s own price', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    // free-form: the kid picks the pillar, writes the words, names the price
    await userEvent.click(await screen.findByRole('button', { name: /ayudar/i }));
    await userEvent.type(screen.getByLabelText(/qué hiciste/i), 'Ordené mi cuarto');
    await userEvent.type(screen.getByLabelText(/cuánto/i), '4000');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(async () => {
      const all = await invoices();
      expect(all.size).toBe(1);
      expect(all.docs[0]!.get('status')).toBe('draft');
      expect(all.docs[0]!.get('description')).toBe('Ordené mi cuarto');
      expect(all.docs[0]!.get('requestedAmount')).toBe(4000);
      expect(all.docs[0]!.get('activityId')).toBeNull();
      expect(all.docs[0]!.get('category')).toBe('help'); // the picked pillar
    }, { timeout: 5000 });
  });

  it('prefills price and activity when it came from the board', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew('?activity=act1');
    // the suggested price is a starting point the kid can change
    await waitFor(() => expect(screen.getByLabelText(/cuánto/i)).toHaveValue('5000'));
    await userEvent.type(screen.getByLabelText(/qué hiciste/i), 'Leí El principito');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(async () => {
      const all = await invoices();
      expect(all.docs[0]!.get('activityId')).toBe('act1');
    }, { timeout: 5000 });
  });

  it('will not save without a description or with an unparseable price', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    await userEvent.click(await screen.findByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/qué hiciste/i), 'algo');
    await userEvent.type(screen.getByLabelText(/cuánto/i), 'abc');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect((await invoices()).size).toBe(0);
  });
});

describe('NewInvoice at 5-8', () => {
  it('offers price choices and a category picker instead of typing', async () => {
    await signInTestKid(await seedKid(2020)); // age 6
    renderNew();
    // no free-text price field at this age
    await waitFor(() => expect(screen.queryByLabelText(/cuánto/i)).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: /valentía/i }));
    const choices = screen.getAllByTestId('price-choice');
    expect(choices.length).toBeGreaterThanOrEqual(3);
    await userEvent.click(choices[1]!);
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(async () => {
      const all = await invoices();
      expect(all.size).toBe(1);
      expect(all.docs[0]!.get('requestedAmount')).toBeGreaterThan(0);
      // the category becomes the description at this age, since the kid did
      // not type anything — the photo is the evidence
      expect(all.docs[0]!.get('description')).toMatch(/valentía/i);
      expect(all.docs[0]!.get('category')).toBe('courage');
    }, { timeout: 5000 });
  });
});

describe('InvoicePhotos', () => {
  it('lists a photo with a remove control, and removing detaches it', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    await userEvent.click(await screen.findByRole('button', { name: /ayudar/i }));
    await userEvent.type(screen.getByLabelText(/qué hiciste/i), 'Con foto');
    await userEvent.type(screen.getByLabelText(/cuánto/i), '1000');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await screen.findByRole('button', { name: /agregar foto/i });

    // the upload itself needs a real browser (jsdom has no image encoder), so
    // attach a path the way a finished upload would and prove the removal
    const all = await invoices();
    const id = all.docs[0]!.id;
    const path = `families/${familyId}/kids/k1/invoices/${id}/seeded.jpg`;
    await seedDoc(`families/${familyId}/invoices/${id}`, {
      kidId: 'k1', activityId: null, description: 'Con foto', photoPaths: [path],
      status: 'draft', requestedAmount: 1000, eventCount: 0, createdAt: new Date(),
      category: 'help',
    });
    await userEvent.click(await screen.findByRole('button', { name: /quitar/i }));
    await waitFor(async () => {
      const after = await invoices();
      expect(after.docs[0]!.get('photoPaths')).toEqual([]);
    }, { timeout: 5000 });
  });

  it('stops offering the add button at the 8-photo cap', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    await userEvent.click(await screen.findByRole('button', { name: /ayudar/i }));
    await userEvent.type(screen.getByLabelText(/qué hiciste/i), 'Ocho fotos');
    await userEvent.type(screen.getByLabelText(/cuánto/i), '1000');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await screen.findByRole('button', { name: /agregar foto/i });

    const id = (await invoices()).docs[0]!.id;
    const paths = Array.from({ length: 8 }, (_, i) =>
      `families/${familyId}/kids/k1/invoices/${id}/p${i}.jpg`);
    await seedDoc(`families/${familyId}/invoices/${id}`, {
      kidId: 'k1', activityId: null, description: 'Ocho fotos', photoPaths: paths,
      status: 'draft', requestedAmount: 1000, eventCount: 0, createdAt: new Date(),
      category: 'help',
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /agregar foto/i })).toBeDisabled());
    expect(screen.getByText(/8\/8/)).toBeInTheDocument();
  });
});
