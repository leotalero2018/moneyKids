import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { collection, doc, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { useDoc } from './useDoc.js';
import { useCollection } from './useCollection.js';
import { signInTestParent, clearFirestoreData } from '../test/emulator.js';

beforeAll(async () => { await signInTestParent('p1'); });

beforeEach(async () => {
  await clearFirestoreData();
  // the real uid, never the literal: the family rules check createdBy and
  // membership against request.auth.uid
  const uid = auth.currentUser!.uid;
  // family + founder member doc MUST be one batch: the rules reject a family
  // whose founder is absent from members/, since it would be unreachable
  const batch = writeBatch(db);
  batch.set(doc(db, 'families/fam1'), {
    name: 'Talero', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, 'families/fam1/members', uid), { role: 'parent', displayName: 'Leo' });
  await batch.commit();
  await setDoc(doc(db, 'families/fam1/kids/k1'), {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
  });
});

describe('useDoc', () => {
  it('loads a document and then reflects live updates', async () => {
    const uid = auth.currentUser!.uid;
    const { result } = renderHook(() => useDoc<{ name: string }>('families/fam1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data?.name).toBe('Talero'));
    await setDoc(doc(db, 'families/fam1'), {
      name: 'Talero-Ruiz', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
    });
    // the point of onSnapshot: no refetch call anywhere in the component
    await waitFor(() => expect(result.current.data?.name).toBe('Talero-Ruiz'));
  });

  it('does not subscribe when the path is null', () => {
    const { result } = renderHook(() => useDoc('families/fam1'));
    const { result: idle } = renderHook(() => useDoc(null));
    expect(idle.current.loading).toBe(false);
    expect(idle.current.data).toBeNull();
    expect(result.current.loading).toBe(true); // the positive case still subscribes
  });

  it('surfaces a permission error instead of hanging in loading', async () => {
    const { result } = renderHook(() => useDoc('families/nope/kids/k1'));
    // a denial is retried a few times first, in case it is the transient
    // kind (a write granting access still in flight), so give it room
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error), { timeout: 8000 });
    expect(result.current.loading).toBe(false);
  });
});

describe('useCollection', () => {
  it('loads matching documents with their ids', async () => {
    const q = query(collection(db, 'families/fam1/kids'), where('birthYear', '==', 2016));
    const { result } = renderHook(() => useCollection<{ name: string }>(q));
    await waitFor(() => expect(result.current.docs).toHaveLength(1));
    expect(result.current.docs[0]).toMatchObject({ id: 'k1', name: 'Mia' });
  });
});
