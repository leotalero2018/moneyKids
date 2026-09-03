import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPin, hasPin, verifyPin, clearPin,
  lockParentView, isParentViewLocked, unlockParentView,
} from './pin.js';
import { kv } from './storage.js';

// clearPin(), not localStorage.clear(): the store is a shim, because jsdom
// exposes no localStorage and real browsers throw on it in private mode
beforeEach(() => { clearPin(); });

describe('pin storage', () => {
  it('stores a digest, never the PIN itself', async () => {
    await setPin('1234');
    expect(hasPin()).toBe(true);
    const stored = kv().getItem('mk.pin.digest');
    expect(stored).toMatch(/^[0-9a-f]{64}$/);   // a SHA-256 digest
    expect(stored).not.toContain('1234');
    expect(kv().getItem('mk.pin.salt')).not.toContain('1234');
    expect(await verifyPin('1234')).toBe(true);
    expect(await verifyPin('9999')).toBe(false);
  });
  it('reports no pin before one is set, and after clearing', async () => {
    expect(hasPin()).toBe(false);
    await setPin('1234');
    clearPin();
    expect(hasPin()).toBe(false);
  });
  it('rejects PINs that are not four to eight digits', async () => {
    await expect(setPin('12')).rejects.toThrow(/pin/i);
    await expect(setPin('abcd')).rejects.toThrow(/pin/i);
    await expect(setPin('123456789')).rejects.toThrow(/pin/i);
  });
});

describe('parent view lock', () => {
  it('unlocks only with the right pin', async () => {
    await setPin('4321');
    lockParentView();
    expect(isParentViewLocked()).toBe(true);
    expect(await unlockParentView('0000')).toBe(false);
    expect(isParentViewLocked()).toBe(true);
    expect(await unlockParentView('4321')).toBe(true);
    expect(isParentViewLocked()).toBe(false);
  });
  it('cannot be locked when no pin is set — that would strand the parent', async () => {
    lockParentView();
    expect(isParentViewLocked()).toBe(false);
  });
});
