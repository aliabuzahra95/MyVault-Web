import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_QURAN_READER_PREFERENCES,
  resolveQuranReaderPreferences,
  saveQuranReaderPreferences,
  subscribeQuranReaderPreferences,
  type QuranReaderPreferences,
} from "@/lib/quran/quranReaderPreferences";

export function useQuranReaderPreferences() {
  const [preferences, setPreferences] = useState<QuranReaderPreferences>(DEFAULT_QURAN_READER_PREFERENCES);
  const preferencesRef = useRef(preferences);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setReady(false);
      void resolveQuranReaderPreferences().then((nextPreferences) => {
        if (cancelled) return;
        preferencesRef.current = nextPreferences;
        setPreferences(nextPreferences);
        setReady(true);
      });
    };
    refresh();
    const unsubscribe = subscribeQuranReaderPreferences(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const updatePreferences = useCallback((patch: Partial<Omit<QuranReaderPreferences, "schemaVersion">>) => {
    const next = { ...preferencesRef.current, ...patch, schemaVersion: 1 as const };
    preferencesRef.current = next;
    setPreferences(next);
    saveQuranReaderPreferences(next);
  }, []);

  return { preferences, preferencesReady: ready, updatePreferences };
}
