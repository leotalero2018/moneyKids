import { deleteApp } from 'firebase/app';
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { kidBundle, newKidBundle, replaceKidBundle } from '../firebase.js';

/**
 * Thrown when the kid cache could not be erased. `JoinKid` catches it and
 * asks the kid to close and reopen the app: a fresh page load reinitializes
 * the instance, and where IndexedDB is unavailable the memory-cache fallback
 * means there is no shared cache to leak in the first place.
 */
export class KidCacheNotClearedError extends Error {
  constructor() { super('the previous kid’s cached data could not be cleared'); }
}

/**
 * Ends a kid session and destroys everything it cached.
 *
 * The order is forced by the SDK and every step is load-bearing:
 *   signOut  — drop the credential first, so nothing can keep reading
 *   terminate— clearIndexedDbPersistence refuses while the instance is live
 *   clear    — the actual erasure; rules never protect cache reads
 *   deleteApp— frees the app NAME so the next initializeApp really builds a
 *              new instance instead of handing back this terminated one
 *   rebuild  — under the same stable name, so a reload finds the right app
 *
 * `deleteApp(app)` is the modular API. There is no `app.delete()`: the v9+
 * `FirebaseApp` interface carries only `name`, `options`, and
 * `automaticDataCollectionEnabled`.
 */
export async function endKidSession(): Promise<void> {
  const fb = kidBundle();
  await signOut(fb.auth).catch(() => undefined);
  await terminate(fb.db);

  // Best-effort erasure: a browser in private mode can refuse IndexedDB
  // outright. Track the outcome rather than swallowing it — if the cache
  // could NOT be cleared, the next kid must not inherit this instance.
  let cleared = true;
  try {
    await clearIndexedDbPersistence(fb.db);
  } catch {
    cleared = false;
  }

  await deleteApp(fb.app).catch(() => undefined);
  replaceKidBundle(newKidBundle());

  if (!cleared) throw new KidCacheNotClearedError();
}
