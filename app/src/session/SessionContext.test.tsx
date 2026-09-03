import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../firebase.js';
import { SessionProvider, useSession } from './SessionContext.js';
import { initI18n } from '../i18n/index.js';
import { signInTestParent, clearFirestoreData } from '../test/emulator.js';

function Probe() {
  const s = useSession();
  return <div data-testid="status">{s.status}:{s.family?.name ?? '-'}</div>;
}

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); });

describe('SessionProvider', () => {
  it('reports signed-out with no user', async () => {
    await signOut(auth);
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
  });

  it('reports no-family for a signed-in parent without a pointer', async () => {
    await signInTestParent('nofamily');
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-family'));
  });

  it('resolves the family through parentIndex and reports ready', async () => {
    await signInTestParent('hasfamily');
    const uid = auth.currentUser!.uid;
    const batch = writeBatch(db);
    batch.set(doc(db, 'families/famA'), {
      name: 'Talero', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
    });
    batch.set(doc(db, 'families/famA/members', uid), { role: 'parent', displayName: 'Leo' });
    batch.set(doc(db, 'parentIndex', uid), { familyId: 'famA' });
    await batch.commit();

    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready:Talero'));
  });
});
