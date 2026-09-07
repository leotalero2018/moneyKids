import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { initI18n } from '../i18n/index.js';
import { clearPin, setPin, isParentViewLocked } from '../lib/pin.js';
import { ProfileSwitcher } from './ProfileSwitcher.js';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

beforeAll(async () => { await initI18n('es'); });
beforeEach(() => { clearPin(); });

function renderSwitcher(direction: 'to-kid' | 'to-parent') {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <ProfileSwitcher direction={direction} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

describe('ProfileSwitcher', () => {
  it('handing over locks the parent view and goes to the kid app', async () => {
    await setPin('1234');
    renderSwitcher('to-kid');
    await userEvent.click(screen.getByRole('button', { name: /pasar el teléfono/i }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/kid'));
    expect(isParentViewLocked()).toBe(true);
  });

  it('refuses to hand over without a PIN, since nothing would lock', async () => {
    renderSwitcher('to-kid');
    await userEvent.click(screen.getByRole('button', { name: /pasar el teléfono/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(isParentViewLocked()).toBe(false);
    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
  });

  it('coming back just navigates — PinGate is what asks for the PIN', async () => {
    await setPin('1234');
    renderSwitcher('to-parent');
    await userEvent.click(screen.getByRole('button', { name: /volver con un adulto/i }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/'));
  });
});
