import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase.js';

const PROJECT_ID = import.meta.env.VITE_FB_PROJECT_ID;
const REST_BASE =
  `http://127.0.0.1:8480/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/**
 * Signs in as a parent with a stable uid-like email, creating them on first
 * use. NOTE: the resulting Firebase uid is NOT the string passed in — seeds
 * must use auth.currentUser!.uid, or every membership check will fail.
 */
export async function signInTestParent(uid: string): Promise<void> {
  const email = `${uid}@example.test`;
  const password = 'test-password';
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch {
    await signInWithEmailAndPassword(auth, email, password);
  }
}

/** Wipes Firestore between tests through the emulator's REST endpoint. */
export async function clearFirestoreData(): Promise<void> {
  await fetch(
    `http://127.0.0.1:8480/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
}

type Json = string | number | boolean | null | Date | Json[] | { [k: string]: Json };

function toValue(v: Json): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  switch (typeof v) {
    case 'string': return { stringValue: v };
    case 'boolean': return { booleanValue: v };
    case 'number':
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    default:
      return { mapValue: { fields: toFields(v as { [k: string]: Json }) } };
  }
}

function toFields(obj: { [k: string]: Json }): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
}

/**
 * Writes a document straight through the emulator's REST API with the
 * `Bearer owner` token, which bypasses security rules — the client-side
 * equivalent of the rules-tests' withSecurityRulesDisabled.
 *
 * Tests need this because most interesting fixtures are states no client may
 * write: kid balances (create must be 0, updates are server-only) and
 * invoices (only a kid session may create one, and only as a draft).
 */
export async function seedDoc(path: string, data: { [k: string]: Json }): Promise<void> {
  const res = await fetch(`${REST_BASE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`seedDoc ${path} failed: ${res.status} ${await res.text()}`);
}
