import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { JoinParent } from './JoinParent.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); });

describe('JoinParent', () => {
  it('rejects a bad code with a visible error and no membership', async () => {
    await signInTestParent('joiner');
    render(<JoinParent />);
    await userEvent.type(screen.getByLabelText(/código/i), 'ABCD2345');
    await userEvent.click(screen.getByRole('button', { name: /unirme/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const uid = auth.currentUser!.uid;
    expect((await getDocFromServer(doc(db, 'parentIndex', uid))).exists()).toBe(false);
  });
});
