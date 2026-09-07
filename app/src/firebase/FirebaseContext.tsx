import { createContext, useContext, type ReactNode } from 'react';
import { parentFb, type FirebaseBundle } from '../firebase.js';

// defaulting to the parent bundle is what keeps Plan 2's screens working
// without a provider anywhere in their tree
const FirebaseCtx = createContext<FirebaseBundle>(parentFb);

export function FirebaseProvider(
  { value, children }: { value: FirebaseBundle; children: ReactNode },
) {
  return <FirebaseCtx.Provider value={value}>{children}</FirebaseCtx.Provider>;
}

export function useFirebase(): FirebaseBundle {
  return useContext(FirebaseCtx);
}
