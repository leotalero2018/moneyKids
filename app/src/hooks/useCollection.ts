import { useEffect, useState } from 'react';
import { onSnapshot, queryEqual, type Query } from 'firebase/firestore';

export interface CollectionState<T> {
  docs: Array<T & { id: string }>;
  loading: boolean;
  error: Error | null;
}

/**
 * Live query read. Callers build the Query inline, so its identity changes on
 * every render — `queryEqual` is what stops that from resubscribing forever.
 */
export function useCollection<T>(q: Query | null): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({
    docs: [], loading: q !== null, error: null,
  });
  const [stable, setStable] = useState<Query | null>(q);
  if (q === null ? stable !== null : stable === null || !queryEqual(q, stable)) {
    setStable(q);
  }

  useEffect(() => {
    if (stable === null) {
      setState({ docs: [], loading: false, error: null });
      return;
    }
    setState({ docs: [], loading: true, error: null });
    const unsub = onSnapshot(
      stable,
      (snap) => setState({
        docs: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T & { id: string }),
        loading: false,
        error: null,
      }),
      (error) => setState({ docs: [], loading: false, error }),
    );
    return unsub;
  }, [stable]);

  return state;
}
