import { useEffect, useRef, useState } from 'react';
import { onSnapshot, queryEqual, type Query } from 'firebase/firestore';

/**
 * A listener denial is often TRANSIENT — see useDoc for why. Five attempts
 * over ~4.5s covers a membership write landing on a slow connection; past
 * that the error is real and gets surfaced.
 */
export const MAX_RETRIES = 5;
export const RETRY_STEP_MS = 300;

export interface CollectionState<T> {
  docs: Array<T & { id: string }>;
  loading: boolean;
  error: Error | null;
}

/**
 * Live query read. Callers build the Query inline, so its identity changes on
 * every render.
 *
 * The equal-query guard lives in a REF, not in state: holding it in state
 * meant a setState during render on every pass, which re-ran the effect,
 * which resubscribed and reset the retry counter — a listener that could
 * never converge and a screen that span forever.
 */
export function useCollection<T>(q: Query | null): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({
    docs: [], loading: q !== null, error: null,
  });

  const stableRef = useRef<Query | null>(q);
  if (q === null
    ? stableRef.current !== null
    : stableRef.current === null || !queryEqual(q, stableRef.current)) {
    stableRef.current = q;
  }
  const stable = stableRef.current;

  useEffect(() => {
    if (stable === null) {
      setState({ docs: [], loading: false, error: null });
      return;
    }
    setState({ docs: [], loading: true, error: null });

    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsub = () => {};

    const subscribe = (): void => {
      unsub = onSnapshot(
        stable,
        (snap) => {
          attempt = 0;
          setState({
            docs: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T & { id: string }),
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
          setState({ docs: [], loading: false, error });
        },
      );
    };
    subscribe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [stable]);

  return state;
}
