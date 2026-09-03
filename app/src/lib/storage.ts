/**
 * Minimal key-value shim over localStorage.
 *
 * Two reasons not to touch `localStorage` directly: Safari and Chrome throw on
 * access in private mode, and jsdom under Vitest does not expose it at all.
 * Callers get a working store either way; when it falls back to memory the
 * value simply does not survive a reload, which for a device-local
 * convenience lock is an acceptable degradation.
 */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();

const memoryStore: KeyValue = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, value); },
  removeItem: (key) => { memory.delete(key); },
};

export function kv(): KeyValue {
  try {
    const store = globalThis.localStorage as KeyValue | undefined;
    if (store) {
      // touch it: presence is not permission in private browsing modes
      store.getItem('mk.probe');
      return store;
    }
  } catch {
    // fall through to memory
  }
  return memoryStore;
}
