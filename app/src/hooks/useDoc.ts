import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '../firebase/FirebaseContext.js';

export interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * A listener denial is often TRANSIENT.
 *
 * Latency compensation shows a write locally the moment it is buffered, so a
 * screen can subscribe to a document whose access-granting sibling — a
 * members doc, say — has not reached the server yet. The rules deny that
 * read, and an onSnapshot error is terminal: without a retry the listener is
 * dead for good and the screen never recovers. A parent who has just created
 * their family would sit on the create-family screen until they reloaded.
 */
const MAX_RETRIES = 5;
const RETRY_STEP_MS = 300;

/** Live single-document read. A null path means "not ready" — no subscription. */
export function useDoc<T>(path: string | null): DocState<T> {
  const { db } = useFirebase();
  const [state, setState] = useState<DocState<T>>({
    data: null, loading: path !== null, error: null,
  });

  useEffect(() => {
    if (path === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState({ data: null, loading: true, error: null });

    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsub = () => {};

    const subscribe = (): void => {
      unsub = onSnapshot(
        doc(db, path),
        (snap) => {
          attempt = 0;
          setState({
            data: snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null,
            loading: false,
            error: null,
          });
        },
        (error) => {
          if (!cancelled && attempt < MAX_RETRIES) {
            attempt += 1;
            timer = setTimeout(() => { if (!cancelled) subscribe(); }, RETRY_STEP_MS * attempt);
            return;
          }
          // give up and surface it: a screen spinning forever is worse than
          // one that says something went wrong
          setState({ data: null, loading: false, error });
        },
      );
    };
    subscribe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
    // db belongs in the deps: switching instances must resubscribe
  }, [path, db]);

  return state;
}
