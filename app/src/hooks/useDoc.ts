import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

export interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/** Live single-document read. A null path means "not ready" — no subscription. */
export function useDoc<T>(path: string | null): DocState<T> {
  const [state, setState] = useState<DocState<T>>({
    data: null, loading: path !== null, error: null,
  });

  useEffect(() => {
    if (path === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState({ data: null, loading: true, error: null });
    const unsub = onSnapshot(
      doc(db, path),
      (snap) => setState({
        data: snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null,
        loading: false,
        error: null,
      }),
      // a denied read must surface, not leave the screen spinning forever
      (error) => setState({ data: null, loading: false, error }),
    );
    return unsub;
  }, [path]);

  return state;
}
