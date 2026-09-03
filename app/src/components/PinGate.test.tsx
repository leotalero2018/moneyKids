import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n/index.js';
import { setPin, lockParentView, clearPin } from '../lib/pin.js';
import { PinGate } from './PinGate.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(() => { clearPin(); });

describe('PinGate', () => {
  it('passes children through when unlocked', () => {
    render(<PinGate><p>secreto</p></PinGate>);
    expect(screen.getByText('secreto')).toBeInTheDocument();
  });
  it('hides children while locked and reveals them on the right pin', async () => {
    await setPin('1234');
    lockParentView();
    render(<PinGate><p>secreto</p></PinGate>);
    expect(screen.queryByText('secreto')).toBeNull();
    await userEvent.type(screen.getByLabelText(/pin/i), '9999');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('secreto')).toBeNull();
    await userEvent.clear(screen.getByLabelText(/pin/i));
    await userEvent.type(screen.getByLabelText(/pin/i), '1234');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    await waitFor(() => expect(screen.getByText('secreto')).toBeInTheDocument());
  });
});
