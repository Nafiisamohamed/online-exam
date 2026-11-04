'use client';
/**
 * useApi(path): loads data from the API with loading / error state and reload().
 * Pass null to skip loading. `pollMs` re-fetches on an interval (invigilator view).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(
    async (silent = false) => {
      if (!path) return;
      if (!silent) setLoading(true);
      try {
        const result = await api<T>(path);
        if (current.current === path) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (current.current === path) setError(err);
      } finally {
        if (current.current === path) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    load();
    if (!pollMs || !path) return;
    const id = setInterval(() => load(true), pollMs);
    return () => clearInterval(id);
  }, [load, pollMs, path]);

  return { data, error, loading, reload: load, setData };
}
