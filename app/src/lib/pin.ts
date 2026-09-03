import { kv } from './storage.js';

const DIGEST_KEY = 'mk.pin.digest';
const SALT_KEY = 'mk.pin.salt';
const LOCK_KEY = 'mk.pin.locked';

async function digest(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Device-local convenience lock. The digest is stored, never the PIN — but
 * this is NOT a security boundary: the parent's Firebase session stays live
 * on the device, exactly as the spec's threat model states. Nothing on the
 * server may ever trust this.
 */
export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('pin must be 4 to 8 digits');
  const salt = crypto.randomUUID();
  kv().setItem(SALT_KEY, salt);
  kv().setItem(DIGEST_KEY, await digest(pin, salt));
}

export function hasPin(): boolean {
  return kv().getItem(DIGEST_KEY) !== null;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = kv().getItem(DIGEST_KEY);
  const salt = kv().getItem(SALT_KEY);
  if (stored === null || salt === null) return false;
  return (await digest(pin, salt)) === stored;
}

export function clearPin(): void {
  kv().removeItem(DIGEST_KEY);
  kv().removeItem(SALT_KEY);
  kv().removeItem(LOCK_KEY);
}

export function lockParentView(): void {
  // locking with no PIN set would strand the parent with no way back in
  if (!hasPin()) return;
  kv().setItem(LOCK_KEY, '1');
}

export function isParentViewLocked(): boolean {
  return hasPin() && kv().getItem(LOCK_KEY) === '1';
}

export async function unlockParentView(pin: string): Promise<boolean> {
  if (!(await verifyPin(pin))) return false;
  kv().removeItem(LOCK_KEY);
  return true;
}
