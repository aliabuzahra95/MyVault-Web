import { useCallback, useEffect, useState } from "react";
import {
  resolveQuranReadingPosition,
  saveQuranReadingPosition,
  subscribeQuranReadingPosition,
  type QuranReadingPosition,
} from "@/lib/quran/quranReadingState";

export function useQuranReadingPosition() {
  const [position, setPosition] = useState<QuranReadingPosition | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void resolveQuranReadingPosition().then((nextPosition) => {
      if (!cancelled) setPosition(nextPosition);
    });
    refresh();
    const unsubscribe = subscribeQuranReadingPosition(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const savePosition = useCallback((surahNumber: number, ayahNumber: number) => {
    saveQuranReadingPosition(surahNumber, ayahNumber);
  }, []);

  return { position, savePosition };
}
