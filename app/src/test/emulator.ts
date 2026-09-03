import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase.js';

const PROJECT_ID = import.meta.env.VITE_FB_PROJECT_ID;

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
