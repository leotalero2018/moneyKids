import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { SignIn } from './SignIn.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await signOut(auth); });

describe('SignIn', () => {
  // each test owns its own email: nothing here may depend on another test
  // having run first, or on the order vitest happens to pick
  it('creates an account and signs in', async () => {
    const email = `new-${crypto.randomUUID()}@example.test`;
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText(/correo/i), email);
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'test-password');
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));
    await waitFor(() => expect(auth.currentUser).not.toBeNull());
  });

  it('shows an error for a wrong password instead of failing silently', async () => {
    const email = `wrong-${crypto.randomUUID()}@example.test`;
    await createUserWithEmailAndPassword(auth, email, 'test-password');
    await signOut(auth);

    render(<SignIn />);
    await userEvent.type(screen.getByLabelText(/correo/i), email);
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(auth.currentUser).toBeNull();
  });
});
