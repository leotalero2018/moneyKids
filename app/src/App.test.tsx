import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase.js';
import { initI18n } from './i18n/index.js';
import { clearFirestoreData, signInTestParent } from './test/emulator.js';
import { App } from './App.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); });

describe('App routing by session status', () => {
  it('shows sign-in when signed out', async () => {
    await signOut(auth);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /entrar/i })).toBeInTheDocument());
  });
  it('shows family creation for a parent with no family', async () => {
    await signInTestParent('brandnew');
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/nombre de la familia/i)).toBeInTheDocument());
  });
});
