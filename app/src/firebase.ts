import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator, getFirestore, initializeFirestore, memoryLocalCache,
  persistentLocalCache, persistentMultipleTabManager, type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

const config = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
};

export interface FirebaseBundle {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  fns: Functions;
  storage: FirebaseStorage;
  label: 'parent' | 'kid';
}

export const KID_APP_NAME = 'kid';

/**
 * Persistent cache is what lets a kid draft an invoice with no signal and
 * have it sync later, which the spec requires.
 *
 * It needs IndexedDB. jsdom has none, and a browser in private mode can
 * refuse it, so fall back to the memory cache rather than failing to start:
 * a kid who cannot cache still gets a working online app. (The component
 * suite therefore runs on the memory cache — persistence across a reload is
 * verified by the Playwright pass.)
 */
function firestoreFor(app: FirebaseApp): Firestore {
  const canPersist = typeof indexedDB !== 'undefined';
  try {
    return initializeFirestore(app, {
      localCache: canPersist
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
    });
  } catch {
    // already initialized for this app (hot reload, or a second call)
    return getFirestore(app);
  }
}

function bundle(label: 'parent' | 'kid'): FirebaseBundle {
  // named apps are what make two live sessions possible: Firebase Auth keys
  // its persisted user by app name, so the parent and the kid do not evict
  // each other
  const app = initializeApp(config, label);
  const auth = getAuth(app);
  const db = firestoreFor(app);
  const fns = getFunctions(app);
  const storage = getStorage(app);
  if (import.meta.env.VITE_USE_EMULATORS) {
    // ports mirror firebase.json; Firestore is on 8480, not the default 8080
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8480);
    connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
  }
  return { app, auth, db, fns, storage, label };
}

export const parentFb = bundle('parent');

/**
 * The kid bundle is REPLACEABLE, not frozen.
 *
 * Firestore's persistent cache is keyed by (app name, project, database) and
 * knows nothing about users: signing out does not clear it, and a cached read
 * is served locally without any rules evaluation, because rules run on the
 * server. On a shared device that means Kid B could read documents Kid A's
 * session cached. So a kid identity change must destroy the cache and rebuild
 * the instance — which is impossible if the bundle is a const the whole app
 * imported. Task 11 implements the reset; this is the seam it needs.
 */
let currentKid = bundle(KID_APP_NAME);

export function kidBundle(): FirebaseBundle { return currentKid; }

export function replaceKidBundle(next: FirebaseBundle): void { currentKid = next; }

/**
 * Rebuilds the kid bundle under the SAME app name.
 *
 * The name must be stable, and a generation counter ('kid-1', 'kid-2', …)
 * would be a bug: Firebase Auth keys its persisted user by app name, and such
 * a counter lives in module memory. After a reload the module re-initializes
 * 'kid', so a kid signed in on 'kid-2' is silently signed out, the 'kid'
 * cache (the FIRST kid's, if a clear ever failed) is the one that comes back,
 * and every reset leaks another IndexedDB database that nothing cleans up.
 *
 * Caller contract: the previous app must already be deleted. `initializeApp`
 * with a live same-name app returns that existing instance — which, after a
 * reset, is the terminated one — so delete first, then call this.
 */
export function newKidBundle(): FirebaseBundle { return bundle(KID_APP_NAME); }

// the original singleton names, bound to the parent bundle: every parent
// screen and test written in Plan 2 keeps working with no edit
export const { auth, db, fns, storage } = parentFb;
