import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  audioPageForAyah,
  loadVerseAudioPage,
  nextAudioAyah,
  type QuranAudioReciter,
  type QuranVerseAudioPage,
} from "@/lib/quran/quranAudioData";

export type QuranAudioStatus = "idle" | "loading" | "playing" | "paused" | "error" | "ended";

export type QuranAudioState = {
  status: QuranAudioStatus;
  ayahNumber: number | null;
  reciter: QuranAudioReciter | null;
  error: string | null;
};

export type QuranAudioEvent =
  | { type: "load"; ayahNumber: number; reciter: QuranAudioReciter }
  | { type: "play" }
  | { type: "pause" }
  | { type: "error"; message: string }
  | { type: "end" }
  | { type: "stop" };

export const INITIAL_QURAN_AUDIO_STATE: QuranAudioState = {
  status: "idle",
  ayahNumber: null,
  reciter: null,
  error: null,
};

export function quranAudioTransition(state: QuranAudioState, event: QuranAudioEvent): QuranAudioState {
  switch (event.type) {
    case "load": return { status: "loading", ayahNumber: event.ayahNumber, reciter: event.reciter, error: null };
    case "play": return state.ayahNumber ? { ...state, status: "playing", error: null } : state;
    case "pause": return state.ayahNumber ? { ...state, status: "paused" } : state;
    case "error": return state.ayahNumber ? { ...state, status: "error", error: event.message } : state;
    case "end": return state.ayahNumber ? { ...state, status: "ended", error: null } : state;
    case "stop": return INITIAL_QURAN_AUDIO_STATE;
  }
}

type UseQuranAudioPlayerOptions = {
  surahNumber: number;
  ayahCount: number;
  currentReaderAyah: number;
  selectedReciter: QuranAudioReciter;
  onAyahChange: (ayahNumber: number) => void;
};

export function useQuranAudioPlayer({ surahNumber, ayahCount, currentReaderAyah, selectedReciter, onAyahChange }: UseQuranAudioPlayerOptions) {
  const [state, dispatch] = useReducer(quranAudioTransition, INITIAL_QURAN_AUDIO_STATE);
  const stateRef = useRef(state);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const preloadRequestRef = useRef<AbortController | null>(null);
  const backgroundRequestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const pagesRef = useRef(new Map<string, QuranVerseAudioPage>());
  const playAyahRef = useRef<(ayahNumber: number, reciter?: QuranAudioReciter) => Promise<void>>(async () => undefined);
  const onAyahChangeRef = useRef(onAyahChange);
  const selectedReciterRef = useRef(selectedReciter);
  const surahRef = useRef(surahNumber);
  const ayahCountRef = useRef(ayahCount);

  stateRef.current = state;
  onAyahChangeRef.current = onAyahChange;
  selectedReciterRef.current = selectedReciter;
  surahRef.current = surahNumber;
  ayahCountRef.current = ayahCount;

  const pageKey = useCallback((reciterId: number, chapter: number, page: number) => `${reciterId}:${chapter}:${page}`, []);

  const loadPage = useCallback(async (reciterId: number, chapter: number, page: number, signal?: AbortSignal) => {
    const key = pageKey(reciterId, chapter, page);
    const cached = pagesRef.current.get(key);
    if (cached) return cached;
    const loaded = await loadVerseAudioPage(reciterId, chapter, page, signal);
    pagesRef.current.set(key, loaded);
    return loaded;
  }, [pageKey]);

  const clearPreloader = useCallback(() => {
    preloadRequestRef.current?.abort();
    preloadRequestRef.current = null;
    const preloader = preloadRef.current;
    if (!preloader) return;
    preloader.removeAttribute("src");
    preloader.load();
    preloadRef.current = null;
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    backgroundRequestRef.current?.abort();
    backgroundRequestRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    clearPreloader();
    dispatch({ type: "stop" });
  }, [clearPreloader]);

  const preloadNext = useCallback(async (ayahNumber: number, reciter: QuranAudioReciter, generation: number) => {
    const nextAyah = nextAudioAyah(ayahNumber, ayahCountRef.current, 1);
    if (!nextAyah) { clearPreloader(); return; }
    clearPreloader();
    const controller = new AbortController();
    preloadRequestRef.current = controller;
    try {
      const chapter = surahRef.current;
      const page = audioPageForAyah(nextAyah);
      const loaded = await loadPage(reciter.id, chapter, page, controller.signal);
      if (generation !== generationRef.current) return;
      const url = loaded.urls.get(`${chapter}:${nextAyah}`);
      if (!url) return;
      preloadRequestRef.current = null;
      const preloader = new Audio();
      preloader.preload = "metadata";
      preloader.src = url;
      preloadRef.current = preloader;
    } catch {
      // Preloading is an optional optimization; playback owns its own concise errors.
    } finally {
      if (preloadRequestRef.current === controller) preloadRequestRef.current = null;
    }
  }, [clearPreloader, loadPage]);

  const playAyah = useCallback(async (ayahNumber: number, reciter = selectedReciterRef.current) => {
    if (!Number.isInteger(ayahNumber) || ayahNumber < 1 || ayahNumber > ayahCountRef.current) return;
    const generation = ++generationRef.current;
    requestRef.current?.abort();
    backgroundRequestRef.current?.abort();
    backgroundRequestRef.current = null;
    const controller = new AbortController();
    requestRef.current = controller;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    clearPreloader();
    dispatch({ type: "load", ayahNumber, reciter });
    try {
      const chapter = surahRef.current;
      const page = await loadPage(reciter.id, chapter, audioPageForAyah(ayahNumber), controller.signal);
      if (generation !== generationRef.current) return;
      const url = page.urls.get(`${chapter}:${ayahNumber}`);
      if (!url) throw new Error(`Audio is unavailable for ${chapter}:${ayahNumber}.`);
      audio.src = url;
      audio.preload = "auto";
      audio.load();
      await audio.play();
      if (generation !== generationRef.current) { audio.pause(); return; }
      requestRef.current = null;
      onAyahChangeRef.current(ayahNumber);
      void preloadNext(ayahNumber, reciter, generation);
    } catch (reason) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      if (reason instanceof DOMException && reason.name === "AbortError" && audio.paused) {
        requestRef.current = null;
        dispatch({ type: "pause" });
        return;
      }
      requestRef.current = null;
      const message = reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "Your browser blocked playback. Tap Play again."
        : reason instanceof TypeError
          ? "Audio could not be loaded. Check your connection and try again."
          : reason instanceof Error && reason.message
            ? reason.message
            : "Audio is temporarily unavailable.";
      dispatch({ type: "error", message });
    }
  }, [clearPreloader, loadPage, preloadNext]);
  playAyahRef.current = playAyah;

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onPlay = () => dispatch({ type: "play" });
    const onPause = () => {
      if (audio.src && !audio.ended) dispatch({ type: "pause" });
    };
    const onEnded = () => {
      const current = stateRef.current.ayahNumber;
      const reciter = stateRef.current.reciter;
      if (!current || !reciter) return;
      const next = nextAudioAyah(current, ayahCountRef.current, 1);
      if (!next) { dispatch({ type: "end" }); clearPreloader(); return; }
      void playAyahRef.current(next, reciter);
    };
    const onError = () => {
      if (audio.error && stateRef.current.ayahNumber) dispatch({ type: "error", message: "This audio file could not be played. Check your connection and try again." });
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      generationRef.current += 1;
      requestRef.current?.abort();
      backgroundRequestRef.current?.abort();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      clearPreloader();
      audioRef.current = null;
    };
  }, [clearPreloader]);

  useEffect(() => {
    backgroundRequestRef.current?.abort();
    const controller = new AbortController();
    backgroundRequestRef.current = controller;
    void loadPage(selectedReciter.id, surahNumber, audioPageForAyah(currentReaderAyah), controller.signal)
      .catch(() => undefined)
      .finally(() => { if (backgroundRequestRef.current === controller) backgroundRequestRef.current = null; });
    return () => {
      controller.abort();
      if (backgroundRequestRef.current === controller) backgroundRequestRef.current = null;
    };
  }, [currentReaderAyah, loadPage, selectedReciter.id, surahNumber]);

  const previousSurahRef = useRef(surahNumber);
  useEffect(() => {
    if (previousSurahRef.current !== surahNumber) {
      previousSurahRef.current = surahNumber;
      stop();
    }
  }, [stop, surahNumber]);

  const toggleAyah = useCallback((ayahNumber: number) => {
    const current = stateRef.current;
    const audio = audioRef.current;
    if (current.ayahNumber !== ayahNumber || !audio?.src || current.reciter?.id !== selectedReciterRef.current.id) {
      void playAyah(ayahNumber);
      return;
    }
    if (current.status === "playing") audio.pause();
    else if (current.status === "paused") void audio.play().catch(() => dispatch({ type: "error", message: "Playback could not resume. Tap Retry." }));
    else if (current.status === "error" || current.status === "ended") void playAyah(ayahNumber);
  }, [playAyah]);

  const move = useCallback((direction: -1 | 1) => {
    const current = stateRef.current.ayahNumber;
    if (!current) return;
    const target = nextAudioAyah(current, ayahCountRef.current, direction);
    if (target) void playAyah(target, stateRef.current.reciter ?? selectedReciterRef.current);
  }, [playAyah]);

  const toggle = useCallback(() => {
    const current = stateRef.current.ayahNumber;
    if (current) toggleAyah(current);
  }, [toggleAyah]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current.ayahNumber) void playAyah(current.ayahNumber, current.reciter ?? selectedReciterRef.current);
  }, [playAyah]);

  const switchReciter = useCallback((reciter: QuranAudioReciter) => {
    const current = stateRef.current.ayahNumber;
    if (current) void playAyah(current, reciter);
  }, [playAyah]);

  return {
    state,
    isActive: state.status !== "idle",
    playAyah,
    toggleAyah,
    toggle,
    previous: () => move(-1),
    next: () => move(1),
    retry,
    stop,
    switchReciter,
  };
}
