import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { kidBundle } from '../firebase.js';
import { FirebaseProvider } from '../firebase/FirebaseContext.js';
import { useDoc } from '../hooks/useDoc.js';
import { ageModeFor, type AgeMode } from './ageMode.js';
import type { Family } from '../session/SessionContext.js';

export interface Kid {
  id: string;
  name: string;
  birthYear: number;
  ageModeOverride?: AgeMode | null;
  deductionsEnabled: boolean;
  spendableBalance: number;
  savingsBalance: number;
}

export interface KidSession {
  familyId: string | null;
  kidId: string | null;
  kid: Kid | null;
  family: Family | null;
  ageMode: AgeMode;
  status: 'loading' | 'signed-out' | 'ready';
}

export const KidCtx = createContext<KidSession | null>(null);

function Inner({ familyId, kidId, resolved, children }: {
  familyId: string | null; kidId: string | null; resolved: boolean; children: ReactNode;
}) {
  const kid = useDoc<Kid>(familyId && kidId ? `families/${familyId}/kids/${kidId}` : null);
  const family = useDoc<Family>(familyId ? `families/${familyId}` : null);

  let status: KidSession['status'] = 'loading';
  if (!resolved) status = 'loading';
  else if (!familyId || !kidId) status = 'signed-out';
  else if (kid.loading || family.loading) status = 'loading';
  else if (kid.data && family.data) status = 'ready';
  else status = 'loading';

  const ageMode = kid.data
    ? ageModeFor(kid.data.birthYear, kid.data.ageModeOverride ?? null)
    : '8-12';

  return (
    <KidCtx.Provider
      value={{ familyId, kidId, kid: kid.data, family: family.data, ageMode, status }}
    >
      {children}
    </KidCtx.Provider>
  );
}

export function KidSessionProvider({ children }: { children: ReactNode }) {
  // read the bundle on every render: Task 11 swaps it on identity change
  const kidFb = kidBundle();
  const [claims, setClaims] = useState<{ familyId: string; kidId: string } | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => onIdTokenChanged(kidFb.auth, (user) => {
    if (!user) {
      setClaims(null);
      setResolved(true);
      return;
    }
    // identity comes from the token, never from the UI.
    // The callback stays SYNCHRONOUS and the promise carries its own catch:
    // an async listener callback rejects into nothing, which is an unhandled
    // rejection in production and a torn-down-environment error in tests.
    void user.getIdTokenResult()
      .then((token) => {
        const familyId = token.claims.familyId;
        const kidId = token.claims.kidId;
        setClaims(
          typeof familyId === 'string' && typeof kidId === 'string'
            ? { familyId, kidId }
            : null,
        );
      })
      .catch(() => setClaims(null))
      .finally(() => setResolved(true));
  }), [kidFb.auth]);

  // every read below must go through the KID instance
  return (
    <FirebaseProvider value={kidFb}>
      <Inner
        familyId={claims?.familyId ?? null}
        kidId={claims?.kidId ?? null}
        resolved={resolved}
      >
        {children}
      </Inner>
    </FirebaseProvider>
  );
}

export function useKidSession(): KidSession {
  const s = useContext(KidCtx);
  if (!s) throw new Error('useKidSession must be used inside a KidSessionProvider');
  return s;
}
