import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const fns = getFunctions(app);

if (import.meta.env.VITE_USE_EMULATORS) {
  // ports mirror firebase.json; Firestore is on 8480, not the default 8080
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8480);
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
}
