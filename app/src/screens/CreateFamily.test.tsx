import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { signInTestParent, clearFirestoreData } from '../test/emulator.js';
import { CreateFamily } from './CreateFamily.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('founder');
});

// no SessionProvider: CreateFamily talks to auth and db directly, and a
// provider here would subscribe to the family the instant the optimistic
// pointer lands, producing a denied read before the batch reaches the server
function renderScreen() {
  return render(<CreateFamily />);
}

describe('CreateFamily', () => {
  it('creates family, founder member doc, and parent pointer in one batch', async () => {
    renderScreen();
    await userEvent.type(screen.getByLabelText(/nombre de la familia/i), 'Talero');
    await userEvent.selectOptions(screen.getByLabelText(/moneda/i), 'COP');
    await userEvent.click(screen.getByRole('button', { name: /crear familia/i }));

    const uid = auth.currentUser!.uid;
    // getDocFromServer, not getDoc: Firestore answers a plain read from its
    // local cache the instant the write is buffered, so a cached read passes
    // before the batch has reached the server and the next read then 404s
    const pointer = await waitFor(async () => {
      const snap = await getDocFromServer(doc(db, 'parentIndex', uid));
      expect(snap.exists()).toBe(true);
      return snap;
    });

    const familyId = pointer.get('familyId') as string;
    const family = await getDocFromServer(doc(db, 'families', familyId));
    expect(family.get('name')).toBe('Talero');
    expect(family.get('currency')).toBe('COP');
    expect(family.get('deductionRules')).toEqual([]);
    const member = await getDocFromServer(doc(db, `families/${familyId}/members`, uid));
    expect(member.get('role')).toBe('parent');
  });

  it('requires a name and warns that currency is permanent', async () => {
    renderScreen();
    expect(screen.getByText(/no se puede cambiar/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /crear familia/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const uid = auth.currentUser!.uid;
    expect((await getDocFromServer(doc(db, 'parentIndex', uid))).exists()).toBe(false);
  });
});
