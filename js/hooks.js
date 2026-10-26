import { useState, useEffect } from './vendor/preact-htm.js';
import { getCachedShow, getShowFull, peekCachedShow } from './api/tvmaze.js';

/**
 * Loads cached TVmaze bundles for a set of show ids (fetching any that are missing)
 * and returns a lookup function. Re-renders once data arrives.
 */
export function useBundles(ids) {
  const [, setTick] = useState(0);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    (async () => {
      const missing = [];
      await Promise.all(ids.map(async id => { if (!(await getCachedShow(id))) missing.push(id); }));
      if (alive) setTick(t => t + 1);
      if (missing.length) {
        await Promise.all(missing.map(id => getShowFull(id).catch(() => null)));
        if (alive) setTick(t => t + 1);
      }
    })();
    return () => { alive = false; };
  }, [key]);
  return id => peekCachedShow(id);
}

export function useAsync(fn, deps) {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setSt(s => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      data => alive && setSt({ loading: false, data, error: null }),
      error => alive && setSt({ loading: false, data: null, error }),
    );
    return () => { alive = false; };
  }, deps);
  return st;
}
