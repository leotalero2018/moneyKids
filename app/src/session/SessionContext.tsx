import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase.js';
import { useDoc } from '../hooks/useDoc.js';
import type { Language } from '../i18n/index.js';
import type { DeductionRule } from '@money-kids/shared';

export interface Family {
  id: string;
  name: string;
  language: Language;
  currency: string;
  createdBy: string;
  deductionRules: DeductionRule[];
}

export interface Session {
  user: User | null;
  familyId: string | null;
  family: Family | null;
  role: 'parent' | null;
  status: 'loading' | 'signed-out' | 'no-family' | 'ready';
}

const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthResolved(true);
  }), []);

  const pointer = useDoc<{ familyId: string }>(user ? `parentIndex/${user.uid}` : null);
  const familyId = pointer.data?.familyId ?? null;
  const family = useDoc<Family>(familyId ? `families/${familyId}` : null);

  let status: Session['status'] = 'loading';
  if (!authResolved) status = 'loading';
  else if (!user) status = 'signed-out';
  // a missing pointer is the normal state for a parent who has not created a
  // family yet, and also for one whose invite acceptance is mid-flight
  else if (pointer.loading || (familyId !== null && family.loading)) status = 'loading';
  else if (!familyId) status = 'no-family';
  else if (family.data) status = 'ready';
  else status = 'no-family';

  return (
    <SessionCtx.Provider
      value={{
        user,
        familyId,
        family: family.data,
        role: status === 'ready' ? 'parent' : null,
        status,
      }}
    >
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession must be used inside a SessionProvider');
  return s;
}
