import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, BookText, ChevronLeft, ChevronRight, Compass, Copy, CornerDownLeft, Hash, Languages, Loader2, MapPin, Minus, Pause, Play, Plus, RotateCcw, Settings2, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import { PageContainer } from "@/components/page-layout";
import { QuranErrorState, QuranLoadingState, useQuranCorpus } from "@/components/quran/quran-shared";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuranReaderPreferences } from "@/hooks/useQuranReaderPreferences";
import { useQuranAudioPlayer, type QuranAudioState } from "@/hooks/useQuranAudioPlayer";
import { useQuranReadingPosition } from "@/hooks/useQuranReadingPosition";
import { useToast } from "@/hooks/use-toast";
import { safeQuranRoute, type QuranAyah, type QuranSurah } from "@/lib/quran/quranData";
import { FALLBACK_QURAN_RECITERS, loadSupportedReciters, type QuranAudioReciter } from "@/lib/quran/quranAudioData";
import { quranCopyPayload, quranReference, toggleExpandedFootnote, toggleSelectedAyah, translationIsVisible } from "@/lib/quran/quranSelection";
import {
  loadMaududiFootnotes,
  loadQuranTranslation,
  loadTafsir,
  loadTafsirSources,
  MUKHTASAR_TAFSIR_SOURCE,
  QURAN_TRANSLATION_SOURCES,
  type QuranTafsirSource,
  type QuranTranslationEntry,
  type QuranTranslationSourceId,
} from "@/lib/quran/quranSupplementalData";
import { cn } from "@/lib/utils";

const BISMILLAH = "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ";
const EMPTY_TRANSLATIONS = new Map<string, QuranTranslationEntry>();

function ReaderHeader({ surah, currentAyah, onJump, onOpenDisplay }: {
  surah: QuranSurah;
  currentAyah: number;
  onJump: (ayahNumber: number) => void;
  onOpenDisplay: () => void;
}) {
  const [jumpValue, setJumpValue] = useState(String(currentAyah));
  useEffect(() => setJumpValue(String(currentAyah)), [currentAyah]);
  return (
    <div className="sticky top-0 z-20 -mx-5 border-b border-border/60 bg-background/90 px-5 py-2.5 backdrop-blur-xl sm:-mx-7 sm:px-7 lg:-mx-10 lg:px-10">
      <div className="mx-auto flex max-w-[980px] flex-wrap items-center gap-2 sm:flex-nowrap">
        <Link href="/quran" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Back to all Surahs">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-[9rem] flex-1">
          <div className="flex items-baseline gap-2"><h1 className="truncate text-sm font-semibold text-foreground sm:text-base">{surah.transliteratedName}</h1><span className="quran-arabic hidden text-base text-muted-foreground sm:inline" dir="rtl" lang="ar">{surah.arabicName}</span></div>
          <p className="text-[10px] font-semibold tabular-nums text-muted-foreground">{currentAyah} / {surah.ayahCount}</p>
        </div>
        <form className="flex h-9 items-center rounded-lg border border-border/70 bg-card/75 pl-2 focus-within:border-primary/50" onSubmit={(event) => { event.preventDefault(); const ayah = Number(jumpValue); if (Number.isInteger(ayah) && ayah >= 1 && ayah <= surah.ayahCount) onJump(ayah); }}>
          <label className="sr-only" htmlFor="quran-ayah-jump">Jump to ayah</label>
          <span className="text-[10px] font-semibold text-muted-foreground">Ayah</span><input id="quran-ayah-jump" type="number" min={1} max={surah.ayahCount} value={jumpValue} onChange={(event) => setJumpValue(event.target.value)} className="h-8 w-11 bg-transparent px-1 text-center text-xs font-semibold tabular-nums outline-none" data-testid="quran-ayah-jump" />
          <button type="submit" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary" aria-label="Jump to ayah"><CornerDownLeft className="h-3.5 w-3.5" /></button>
        </form>
        <button type="button" onClick={onOpenDisplay} className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Display settings" data-testid="quran-display-settings"><Settings2 className="h-4 w-4" /><span className="hidden sm:inline">Display</span></button>
      </div>
    </div>
  );
}

function QuranAudioMiniPlayer({ state, surah, onPrevious, onToggle, onNext, onRetry, onStop }: {
  state: QuranAudioState;
  surah: QuranSurah;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
  onRetry: () => void;
  onStop: () => void;
}) {
  if (!state.ayahNumber || !state.reciter) return null;
  const loading = state.status === "loading";
  const playing = state.status === "playing";
  const hasError = state.status === "error";
  return (
    <aside className="fixed bottom-3 left-1/2 z-30 w-[calc(100%-1.5rem)] max-w-[660px] -translate-x-1/2 rounded-xl border border-border/80 bg-background/95 shadow-[0_16px_48px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:shadow-[0_16px_48px_rgba(0,0,0,0.42)]" aria-label="Qur’an audio player" data-testid="quran-audio-player">
      <div className="flex min-h-[66px] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className={cn("h-4 w-4", playing && "animate-pulse")} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-foreground">{surah.transliteratedName} · {surah.number}:{state.ayahNumber}</span>
          <span className={cn("mt-0.5 block truncate text-[10px] font-medium", hasError ? "text-destructive" : "text-muted-foreground")}>{hasError ? state.error : `${state.reciter.name} · ${loading ? "Loading" : playing ? "Playing" : state.status === "ended" ? "Surah complete" : "Paused"}`}</span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Playback controls">
          {hasError ? <button type="button" onClick={onRetry} className="flex h-9 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="quran-audio-retry"><RotateCcw className="h-3.5 w-3.5" /> Retry</button> : null}
          {!hasError ? <button type="button" onClick={onPrevious} disabled={loading || state.ayahNumber <= 1} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35" aria-label="Previous ayah" data-testid="quran-audio-previous"><SkipBack className="h-4 w-4" /></button> : null}
          {!hasError ? <button type="button" onClick={onToggle} disabled={loading} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60" aria-label={playing ? "Pause recitation" : "Resume recitation"} data-testid="quran-audio-toggle">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}</button> : null}
          {!hasError ? <button type="button" onClick={onNext} disabled={loading || state.ayahNumber >= surah.ayahCount} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35" aria-label="Next ayah" data-testid="quran-audio-next"><SkipForward className="h-4 w-4" /></button> : null}
          <button type="button" onClick={onStop} className="ml-0.5 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Stop and close player" data-testid="quran-audio-stop"><X className="h-4 w-4" /></button>
        </div>
      </div>
    </aside>
  );
}

function QuranDisplayPanel({ open, onOpenChange, arabicFontPercent, audioReciters, audioRecitersLoading, selectedReciterId, translationEnabled, translationSource, translationLoading, tafsirSourceId, onArabicFontPercent, onSelectReciter, onToggleTranslation, onSelectTranslation, onSelectTafsir }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  arabicFontPercent: number;
  audioReciters: QuranAudioReciter[];
  audioRecitersLoading: boolean;
  selectedReciterId: number;
  translationEnabled: boolean;
  translationSource: QuranTranslationSourceId;
  translationLoading: boolean;
  tafsirSourceId: number;
  onArabicFontPercent: (percent: number) => void;
  onSelectReciter: (reciter: QuranAudioReciter) => void;
  onToggleTranslation: () => void;
  onSelectTranslation: (source: QuranTranslationSourceId) => void;
  onSelectTafsir: (sourceId: number) => void;
}) {
  const isMobile = useIsMobile();
  const [sources, setSources] = useState<QuranTafsirSource[]>([MUKHTASAR_TAFSIR_SOURCE]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadTafsirSources().then((next) => { if (!cancelled) setSources(next); });
    return () => { cancelled = true; };
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("flex flex-col gap-0 overflow-hidden border-border bg-background p-0 data-[state=closed]:duration-150 data-[state=open]:duration-150", isMobile ? "h-auto max-h-[88dvh] rounded-t-2xl" : "w-[min(420px,42vw)] sm:max-w-[420px]")} data-testid="quran-display-panel">
        <SheetHeader className="border-b border-border/60 px-5 py-5 text-left sm:px-6">
          <div className="pr-10 text-[10px] font-bold uppercase tracking-[0.17em] text-primary">Reader</div>
          <SheetTitle className="pr-10 text-xl">Display settings</SheetTitle>
          <SheetDescription>Adjust the reading surface without changing the Qur’an text.</SheetDescription>
        </SheetHeader>
        <div className="space-y-7 overflow-y-auto px-5 py-6 sm:px-6">
          <section>
            <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-foreground">Arabic size</h3><p className="mt-0.5 text-xs text-muted-foreground">Qur’anic text only</p></div><span className="text-xs font-semibold tabular-nums text-muted-foreground">{arabicFontPercent}%</span></div>
            <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-3">
              <button type="button" onClick={() => onArabicFontPercent(arabicFontPercent - 10)} disabled={arabicFontPercent <= 70} className="flex h-10 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-primary/30 hover:text-primary disabled:opacity-35" aria-label="Decrease Arabic text size"><Minus className="h-4 w-4" /></button>
              <div className="quran-arabic text-center text-2xl text-foreground" dir="rtl" lang="ar">بِسْمِ اللهِ</div>
              <button type="button" onClick={() => onArabicFontPercent(arabicFontPercent + 10)} disabled={arabicFontPercent >= 140} className="flex h-10 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-primary/30 hover:text-primary disabled:opacity-35" aria-label="Increase Arabic text size"><Plus className="h-4 w-4" /></button>
            </div>
          </section>
          <section className="border-t border-border/60 pt-6">
            <label className="block text-sm font-semibold text-foreground" htmlFor="quran-audio-reciter">Reciter</label>
            <p className="mt-0.5 text-xs text-muted-foreground">Ayah-by-ayah continuous recitation</p>
            <select id="quran-audio-reciter" value={selectedReciterId} onChange={(event) => { const reciter = audioReciters.find((item) => item.id === Number(event.target.value)); if (reciter) onSelectReciter(reciter); }} disabled={audioRecitersLoading} className="mt-3 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" data-testid="quran-audio-reciter">{audioReciters.map((reciter) => <option key={reciter.id} value={reciter.id}>{reciter.name}</option>)}</select>
          </section>
          <section className="border-t border-border/60 pt-6">
            <div className="flex items-center justify-between gap-4"><div><h3 className="text-sm font-semibold text-foreground">Translation</h3><p className="mt-0.5 text-xs text-muted-foreground">Show beneath each ayah</p></div><button type="button" onClick={onToggleTranslation} className={cn("relative h-6 w-11 rounded-full transition-colors duration-150", translationEnabled ? "bg-primary" : "bg-muted")} aria-pressed={translationEnabled} data-testid="quran-translation-toggle"><span className={cn("absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150", translationEnabled ? "translate-x-5" : "translate-x-0.5")} /></button></div>
            <label className="mt-4 block text-xs font-semibold text-muted-foreground" htmlFor="quran-translation-source">Translation source</label>
            <select id="quran-translation-source" value={translationSource} onChange={(event) => onSelectTranslation(event.target.value as QuranTranslationSourceId)} disabled={translationLoading || !translationEnabled} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" data-testid="quran-translation-source">{QURAN_TRANSLATION_SOURCES.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
          </section>
          <section className="border-t border-border/60 pt-6">
            <label className="block text-sm font-semibold text-foreground" htmlFor="quran-default-tafsir-source">Default Tafsir</label><p className="mt-0.5 text-xs text-muted-foreground">Used when opening Tafsir for an ayah</p>
            <select id="quran-default-tafsir-source" value={sources.some((source) => source.id === tafsirSourceId) ? tafsirSourceId : -1} onChange={(event) => onSelectTafsir(Number(event.target.value))} className="mt-3 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring" data-testid="quran-display-tafsir-source">{sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.language}</option>)}</select>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TranslationText({ entry, fontPercent }: { entry: QuranTranslationEntry; fontPercent: number }) {
  const [expandedFootnoteId, setExpandedFootnoteId] = useState<string | null>(null);
  useEffect(() => setExpandedFootnoteId(null), [entry]);
  const parts: ReactNode[] = [];
  let cursor = 0;
  entry.footnotes.forEach((footnote) => {
    parts.push(entry.text.slice(cursor, footnote.markerStart));
    parts.push(
      <button key={footnote.id} type="button" className="mx-0.5 inline-flex min-h-6 min-w-6 items-center justify-center rounded text-[0.72em] font-extrabold text-primary underline decoration-primary/35 underline-offset-2 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Footnote ${footnote.label}`} aria-expanded={expandedFootnoteId === footnote.id} onClick={(event) => { event.stopPropagation(); setExpandedFootnoteId((current) => toggleExpandedFootnote(current, footnote.id)); }} data-testid={`quran-footnote-${footnote.label}`}>
        <sup>{footnote.label}</sup>
      </button>,
    );
    cursor = footnote.markerEndExclusive;
  });
  parts.push(entry.text.slice(cursor));
  const expanded = entry.footnotes.find((footnote) => footnote.id === expandedFootnoteId) ?? null;
  return (
    <div className="mt-3" dir="ltr" lang="en">
      <p className="max-w-[48rem] text-foreground/72 dark:text-foreground/70" style={{ fontSize: `${0.96 * Math.min(130, Math.max(80, fontPercent)) / 100}rem`, lineHeight: 1.78 }} data-testid="quran-translation-text">{parts}</p>
      {expanded ? <div className="mt-3 animate-in border-l-2 border-primary/35 bg-muted/30 px-4 py-3 text-sm leading-6 text-muted-foreground fade-in slide-in-from-top-1 duration-150" onClick={(event) => event.stopPropagation()} data-testid={`quran-footnote-content-${expanded.label}`}><div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Footnote {expanded.label}</div>{expanded.text}</div> : null}
    </div>
  );
}

type AyahRowProps = {
  ayah: QuranAyah;
  surah: QuranSurah;
  current: boolean;
  selected: boolean;
  audioStatus: QuranAudioState["status"] | null;
  translationEnabled: boolean;
  translation: QuranTranslationEntry | null;
  arabicFontPercent: number;
  translationFontPercent: number;
  onSelect: (ayahNumber: number) => void;
  onCopy: (action: "arabic" | "translation" | "reference", ayah: QuranAyah, translation: QuranTranslationEntry | null) => void;
  onOpenTafsir: (ayah: QuranAyah) => void;
  onToggleAudio: (ayahNumber: number) => void;
};

const QuranAyahRow = memo(function QuranAyahRow({ ayah, surah, current, selected, audioStatus, translationEnabled, translation, arabicFontPercent, translationFontPercent, onSelect, onCopy, onOpenTafsir, onToggleAudio }: AyahRowProps) {
  const reference = quranReference(surah.transliteratedName, surah.number, ayah.ayahNumber);
  const showTranslation = translationIsVisible(translationEnabled, translation);
  const select = () => onSelect(ayah.ayahNumber);
  const nestedControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("button, a, select, input"));
  return (
    <article id={`ayah-${ayah.ayahNumber}`} data-ayah={ayah.ayahNumber} className={cn("quran-ayah group relative scroll-mt-28 border-b border-border/55 px-2 py-5 transition-[background-color,box-shadow] duration-150 last:border-b-0 sm:scroll-mt-36 sm:px-5 sm:py-6", selected && "z-[1] bg-primary/[0.022] shadow-[inset_2px_0_0_hsl(var(--primary)/0.72)] dark:bg-primary/[0.035]")} aria-current={current ? "location" : undefined} aria-label={`${reference}${selected ? ", selected" : ""}. Select for ayah actions.`} tabIndex={0} onClick={(event) => { if (!nestedControl(event.target)) select(); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); select(); } }} data-selected={selected ? "true" : "false"} data-testid={`quran-ayah-${ayah.ayahNumber}`}>
      <div className="mb-2 flex min-h-7 items-center gap-2">
        <Link href={`/quran/${surah.number}/${ayah.ayahNumber}`} className="rounded px-1 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-primary" aria-label={`Link to ${surah.transliteratedName} ayah ${ayah.ayahNumber}`}>{surah.number}:{ayah.ayahNumber}</Link>
        {current ? <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em] text-primary"><MapPin className="h-3 w-3" /> Last read</span> : null}
        {audioStatus ? <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em] text-primary" data-testid={`quran-audio-state-${ayah.ayahNumber}`}><Volume2 className={cn("h-3 w-3", audioStatus === "playing" && "animate-pulse")} /> {audioStatus === "loading" ? "Loading" : audioStatus === "playing" ? "Playing" : audioStatus === "error" ? "Audio issue" : audioStatus === "ended" ? "Complete" : "Paused"}</span> : null}
        <span className="ml-auto text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">Select for actions</span>
      </div>
      <p className="quran-arabic text-right text-foreground" style={{ fontSize: `${2.1 * Math.min(140, Math.max(70, arabicFontPercent)) / 100}rem`, lineHeight: 1.95 }} dir="rtl" lang="ar">{ayah.arabicText}</p>
      {showTranslation && translation ? <TranslationText entry={translation} fontPercent={translationFontPercent} /> : null}
      {selected ? (
        <div className="mt-3 flex animate-in flex-wrap items-center gap-1.5 border-t border-border/55 pt-2.5 fade-in slide-in-from-top-1 duration-150" role="toolbar" aria-label={`Actions for ${reference}`} data-testid="quran-ayah-toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => onToggleAudio(ayah.ayahNumber)} className="quran-action-button" aria-label={`${audioStatus === "playing" ? "Pause" : "Play"} ${reference}`} data-testid="quran-play-ayah">{audioStatus === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : audioStatus === "playing" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {audioStatus === "playing" ? "Pause" : "Play"}</button>
          <button type="button" onClick={() => onOpenTafsir(ayah)} className="quran-action-button" data-testid="quran-open-tafsir"><BookText className="h-3.5 w-3.5" /> Tafsir</button>
          <button type="button" onClick={() => onCopy("arabic", ayah, translation)} className="quran-action-button" data-testid="quran-copy-arabic"><Copy className="h-3.5 w-3.5" /> Arabic</button>
          {showTranslation ? <button type="button" onClick={() => onCopy("translation", ayah, translation)} className="quran-action-button" data-testid="quran-copy-translation"><Languages className="h-3.5 w-3.5" /> Translation</button> : null}
          <button type="button" onClick={() => onCopy("reference", ayah, translation)} className="quran-action-button" data-testid="quran-copy-reference"><Hash className="h-3.5 w-3.5" /> Reference</button>
        </div>
      ) : null}
    </article>
  );
});

function TafsirPanel({ open, ayah, surah, selectedSourceId, onSelectedSourceId, onOpenChange }: {
  open: boolean;
  ayah: QuranAyah | null;
  surah: QuranSurah;
  selectedSourceId: number;
  onSelectedSourceId: (sourceId: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [sources, setSources] = useState<QuranTafsirSource[]>([MUKHTASAR_TAFSIR_SOURCE]);
  const [sourcesReady, setSourcesReady] = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSourcesReady(false);
    void loadTafsirSources().then((next) => {
      if (cancelled) return;
      setSources(next);
      setSourcesReady(true);
      if (!next.some((source) => source.id === selectedSourceId)) onSelectedSourceId(-1);
    });
    return () => { cancelled = true; };
  }, [onSelectedSourceId, open, selectedSourceId]);

  const source = sources.find((candidate) => candidate.id === selectedSourceId) ?? MUKHTASAR_TAFSIR_SOURCE;
  useEffect(() => {
    if (!open || !ayah || !sourcesReady) return;
    let cancelled = false;
    setLoading(true); setError(null); setContent("");
    void loadTafsir(ayah.verseKey, source.id)
      .then((next) => { if (!cancelled) setContent(next); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "This Tafsir could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ayah, open, retry, source.id, sourcesReady]);

  const reference = ayah ? quranReference(surah.transliteratedName, surah.number, ayah.ayahNumber) : "";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("flex flex-col gap-0 overflow-hidden border-border bg-background p-0 data-[state=closed]:duration-150 data-[state=open]:duration-150", isMobile ? "h-[94dvh] rounded-t-2xl" : "w-[min(600px,48vw)] sm:max-w-[600px]")} data-testid="quran-tafsir-panel">
        <SheetHeader className="border-b border-border/60 px-5 pb-5 pt-6 text-left sm:px-8">
          <div className="pr-10 text-[10px] font-bold uppercase tracking-[0.17em] text-primary">Tafsir</div>
          <SheetTitle className="pr-10 text-2xl tracking-[-0.02em]">{reference}</SheetTitle>
          <SheetDescription>{surah.arabicName} · {ayah ? `Ayah ${ayah.ayahNumber}` : "Selected ayah"}</SheetDescription>
          <div className="pt-3"><label htmlFor="quran-tafsir-source" className="mb-1.5 block text-xs font-semibold text-muted-foreground">Source</label><select id="quran-tafsir-source" value={source.id} onChange={(event) => onSelectedSourceId(Number(event.target.value))} disabled={!sourcesReady} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring" data-testid="quran-tafsir-source">{sources.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.language}{item.availability === "offline" ? " · Offline" : ""}</option>)}</select></div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-7 sm:px-8" data-testid="quran-tafsir-scroll">
          {!sourcesReady || loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm font-medium text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading {source.name}</div> : null}
          {error ? <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm leading-6 text-muted-foreground" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">Try again</button></div> : null}
          {!loading && !error && content ? <article className={cn("mx-auto max-w-[34rem] whitespace-pre-wrap text-[1rem] leading-[1.88] text-foreground/90", source.direction === "rtl" && "quran-tafsir-arabic text-right text-[1.12rem] leading-[2]")} dir={source.direction} lang={source.language === "Arabic" ? "ar" : "en"} data-testid="quran-tafsir-content">{content}</article> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text; textarea.style.position = "fixed"; textarea.style.opacity = "0"; document.body.append(textarea); textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access was denied.");
}

export function QuranReaderPage() {
  const params = useParams<{ surah: string; ayah: string }>();
  const [, navigate] = useLocation();
  const { corpus, error } = useQuranCorpus();
  const { savePosition } = useQuranReadingPosition();
  const { preferences, updatePreferences } = useQuranReaderPreferences();
  const { toast } = useToast();
  const [currentAyah, setCurrentAyah] = useState(() => Number(params.ayah) || 1);
  const [selectedAyah, setSelectedAyah] = useState<number | null>(null);
  const [tafsirAyah, setTafsirAyah] = useState<number | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [translations, setTranslations] = useState(EMPTY_TRANSLATIONS);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationMessage, setTranslationMessage] = useState<string | null>(null);
  const [audioReciters, setAudioReciters] = useState<QuranAudioReciter[]>(FALLBACK_QURAN_RECITERS);
  const [audioRecitersLoading, setAudioRecitersLoading] = useState(true);
  const internalRouteKey = useRef<string | null>(null);
  const initialPositioning = useRef(true);
  const layoutObserverSuppressed = useRef(false);
  const layoutChangeVersion = useRef(0);
  const layoutAnchorAyah = useRef(currentAyah);
  const currentAyahRef = useRef(currentAyah);
  const readingNavigationIntentUntil = useRef(0);
  const audioAutoScrollSuppressedUntil = useRef(0);
  const route = useMemo(() => corpus ? safeQuranRoute(corpus.surahs, params.surah, params.ayah) : null, [corpus, params.ayah, params.surah]);
  const ayahs = route ? corpus?.ayahsBySurah.get(route.surah.number) ?? [] : [];
  const surahNumber = route?.surah.number;
  const surahNumberRef = useRef(surahNumber);
  surahNumberRef.current = surahNumber;
  const selectedReciter = useMemo(
    () => audioReciters.find((reciter) => reciter.id === preferences.audioReciterId) ?? audioReciters[0] ?? FALLBACK_QURAN_RECITERS[0],
    [audioReciters, preferences.audioReciterId],
  );

  useEffect(() => {
    let cancelled = false;
    setAudioRecitersLoading(true);
    void loadSupportedReciters().then((reciters) => {
      if (cancelled) return;
      setAudioReciters(reciters);
      setAudioRecitersLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!audioRecitersLoading && !audioReciters.some((reciter) => reciter.id === preferences.audioReciterId)) {
      updatePreferences({ audioReciterId: selectedReciter.id });
    }
  }, [audioReciters, audioRecitersLoading, preferences.audioReciterId, selectedReciter.id, updatePreferences]);

  const followAudioAyah = useCallback((ayahNumber: number) => {
    if (!route) return;
    const key = `${route.surah.number}:${ayahNumber}`;
    internalRouteKey.current = key;
    currentAyahRef.current = ayahNumber;
    setCurrentAyah(ayahNumber);
    navigate(`/quran/${route.surah.number}/${ayahNumber}`, { replace: true });
    savePosition(route.surah.number, ayahNumber);
    if (Date.now() < audioAutoScrollSuppressedUntil.current) return;
    requestAnimationFrame(() => {
      const element = document.getElementById(`ayah-${ayahNumber}`);
      const bounds = element?.getBoundingClientRect();
      const topComfort = window.matchMedia("(max-width: 639px)").matches ? 170 : 145;
      if (element && bounds && (bounds.top < topComfort || bounds.bottom > window.innerHeight - 96)) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }, [navigate, route, savePosition]);

  const audioPlayer = useQuranAudioPlayer({
    surahNumber: route?.surah.number ?? 1,
    ayahCount: route?.surah.ayahCount ?? 7,
    currentReaderAyah: currentAyah,
    selectedReciter,
    onAyahChange: followAudioAyah,
  });

  useEffect(() => { currentAyahRef.current = currentAyah; }, [currentAyah]);
  const beginLayoutChange = useCallback(() => {
    if (!layoutObserverSuppressed.current) layoutAnchorAyah.current = currentAyahRef.current;
    layoutObserverSuppressed.current = true;
    return { version: ++layoutChangeVersion.current, surah: surahNumberRef.current, ayah: layoutAnchorAyah.current };
  }, []);
  const finishLayoutChange = useCallback((change: { version: number; surah: number | undefined; ayah: number }) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (change.version !== layoutChangeVersion.current) return;
      document.getElementById(`ayah-${change.ayah}`)?.scrollIntoView({ block: "start" });
      requestAnimationFrame(() => {
        if (change.version !== layoutChangeVersion.current) return;
        if (change.surah) {
          const key = `${change.surah}:${change.ayah}`;
          internalRouteKey.current = key;
          currentAyahRef.current = change.ayah;
          setCurrentAyah(change.ayah);
          navigate(`/quran/${change.surah}/${change.ayah}`, { replace: true });
          savePosition(change.surah, change.ayah);
        }
        layoutAnchorAyah.current = change.ayah;
        layoutObserverSuppressed.current = false;
      });
    }));
  }, [navigate, savePosition]);

  useEffect(() => { setSelectedAyah(null); setTafsirAyah(null); }, [surahNumber]);
  useEffect(() => {
    const markReadingNavigationIntent = () => {
      readingNavigationIntentUntil.current = Date.now() + 1200;
      audioAutoScrollSuppressedUntil.current = Date.now() + 5000;
    };
    const markKeyboardNavigationIntent = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) markReadingNavigationIntent();
    };
    const markScrollbarNavigationIntent = (event: PointerEvent) => {
      if (event.clientX >= document.documentElement.clientWidth - 20) markReadingNavigationIntent();
    };
    window.addEventListener("wheel", markReadingNavigationIntent, { passive: true });
    window.addEventListener("touchmove", markReadingNavigationIntent, { passive: true });
    window.addEventListener("keydown", markKeyboardNavigationIntent);
    window.addEventListener("pointerdown", markScrollbarNavigationIntent);
    return () => {
      window.removeEventListener("wheel", markReadingNavigationIntent);
      window.removeEventListener("touchmove", markReadingNavigationIntent);
      window.removeEventListener("keydown", markKeyboardNavigationIntent);
      window.removeEventListener("pointerdown", markScrollbarNavigationIntent);
    };
  }, []);
  useEffect(() => {
    const layoutChange = beginLayoutChange();
    if (!surahNumber || !preferences.translationEnabled) { setTranslationLoading(false); setTranslationMessage(null); setTranslations(EMPTY_TRANSLATIONS); finishLayoutChange(layoutChange); return; }
    let cancelled = false;
    setTranslationLoading(true); setTranslationMessage(null); setTranslations(EMPTY_TRANSLATIONS);
    void loadQuranTranslation(preferences.translationSource)
      .then((bundled) => {
        if (cancelled) return;
        setTranslations(bundled); setTranslationLoading(false);
        finishLayoutChange(layoutChange);
        if (preferences.translationSource === "maududi") {
          void loadMaududiFootnotes(surahNumber)
            .then((enriched) => {
              if (cancelled || !enriched.size) return;
              const footnoteLayoutChange = beginLayoutChange();
              setTranslations(new Map([...bundled, ...enriched]));
              finishLayoutChange(footnoteLayoutChange);
            })
            .catch(() => { if (!cancelled) setTranslationMessage("Offline Maududi translation shown. Explanatory footnotes are temporarily unavailable."); });
        }
      })
      .catch((reason) => { if (!cancelled) { setTranslationLoading(false); setTranslationMessage(reason instanceof Error ? reason.message : "The translation could not be loaded."); finishLayoutChange(layoutChange); } });
    return () => { cancelled = true; };
  }, [beginLayoutChange, finishLayoutChange, preferences.translationEnabled, preferences.translationSource, surahNumber]);

  useEffect(() => {
    if (!route) return;
    const key = `${route.surah.number}:${route.ayahNumber}`;
    setCurrentAyah(route.ayahNumber);
    if (internalRouteKey.current === key) { internalRouteKey.current = null; return; }
    savePosition(route.surah.number, route.ayahNumber); initialPositioning.current = true;
    const frame = requestAnimationFrame(() => { document.getElementById(`ayah-${route.ayahNumber}`)?.scrollIntoView({ block: "start" }); requestAnimationFrame(() => { initialPositioning.current = false; }); });
    return () => cancelAnimationFrame(frame);
  }, [route, savePosition]);

  useEffect(() => {
    if (!route || !ayahs.length) return;
    const topOffset = window.matchMedia("(max-width: 639px)").matches ? 158 : 138;
    const elements = ayahs.map((ayah) => document.getElementById(`ayah-${ayah.ayahNumber}`)).filter((element): element is HTMLElement => Boolean(element));
    const observer = new IntersectionObserver(() => {
      if (initialPositioning.current || layoutObserverSuppressed.current || Date.now() > readingNavigationIntentUntil.current) return;
      const visible = elements
        .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
        .filter(({ bounds }) => bounds.bottom > topOffset && bounds.top < window.innerHeight * 0.55)
        .toSorted((a, b) => Math.abs(a.bounds.top - (topOffset + 6)) - Math.abs(b.bounds.top - (topOffset + 6)))[0];
      const ayah = Number(visible?.element.dataset.ayah);
      if (!Number.isInteger(ayah) || ayah < 1 || ayah > route.surah.ayahCount) return;
      if (currentAyahRef.current === ayah) return;
      currentAyahRef.current = ayah;
      setCurrentAyah(ayah);
      internalRouteKey.current = `${route.surah.number}:${ayah}`;
      navigate(`/quran/${route.surah.number}/${ayah}`, { replace: true });
      savePosition(route.surah.number, ayah);
    }, { rootMargin: `-${topOffset}px 0px -55% 0px`, threshold: [0, 0.2, 0.65] });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [ayahs, navigate, route, savePosition]);

  const jump = useCallback((ayah: number) => { if (route) { savePosition(route.surah.number, ayah); navigate(`/quran/${route.surah.number}/${ayah}`); } }, [navigate, route, savePosition]);
  const preserveCurrentAyahDuringLayoutChange = useCallback((update: () => void) => {
    const layoutChange = beginLayoutChange();
    update();
    finishLayoutChange(layoutChange);
  }, [beginLayoutChange, finishLayoutChange]);
  const select = useCallback((ayah: number) => setSelectedAyah((current) => toggleSelectedAyah(current, ayah)), []);
  const copy = useCallback((action: "arabic" | "translation" | "reference", ayah: QuranAyah, translation: QuranTranslationEntry | null) => {
    if (!route) return;
    const reference = quranReference(route.surah.transliteratedName, route.surah.number, ayah.ayahNumber);
    const text = quranCopyPayload(action, { arabicText: ayah.arabicText, translation, reference });
    if (text) void writeClipboard(text).then(() => toast({ title: "Copied", description: action === "reference" ? reference : `${reference} ${action}` })).catch(() => toast({ title: "Copy unavailable", description: "Your browser did not allow clipboard access.", variant: "destructive" }));
  }, [route, toast]);
  const openTafsir = useCallback((ayah: QuranAyah) => setTafsirAyah(ayah.ayahNumber), []);
  const selectTafsirSource = useCallback((id: number) => updatePreferences({ tafsirSourceId: id }), [updatePreferences]);

  if (error) return <PageContainer><QuranErrorState message={error} /></PageContainer>;
  if (!corpus) return <PageContainer><QuranLoadingState /></PageContainer>;
  if (!route) return <PageContainer className="max-w-[760px]"><div className="rounded-xl border border-border bg-card p-7 text-center"><Compass className="mx-auto h-8 w-8 text-primary" /><h1 className="mt-4 text-lg font-semibold">That Quran reference does not exist</h1><p className="mt-2 text-sm text-muted-foreground">Use a reference between 1:1 and 114:6.</p><Link href="/quran" className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Choose a Surah</Link></div></PageContainer>;

  const previous = corpus.surahs[route.surah.number - 2] ?? null;
  const next = corpus.surahs[route.surah.number] ?? null;
  const tafsirTarget = tafsirAyah ? ayahs[tafsirAyah - 1] ?? null : null;
  return (
    <PageContainer className={cn("max-w-[1200px] pt-0", audioPlayer.isActive ? "pb-32" : "pb-14")}>
      <ReaderHeader surah={route.surah} currentAyah={currentAyah} onJump={jump} onOpenDisplay={() => setDisplayOpen(true)} />
      {preferences.translationEnabled && translationLoading ? <div className="mx-auto mt-3 flex max-w-[980px] items-center gap-2 px-2 text-xs font-medium text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Loading {QURAN_TRANSLATION_SOURCES.find((source) => source.id === preferences.translationSource)?.name}</div> : null}
      {translationMessage ? <p className="mx-auto mt-3 max-w-[980px] px-2 text-xs font-medium text-muted-foreground" role="status">{translationMessage}</p> : null}
      <main className="mx-auto max-w-[980px]" data-testid="quran-reading-column">
        <header className="border-b border-border/60 px-3 py-8 text-center sm:py-10">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Surah {route.surah.number}</p>
          <div className="mt-2 flex items-baseline justify-center gap-3"><h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{route.surah.transliteratedName}</h2><p className="quran-arabic text-2xl text-foreground" dir="rtl" lang="ar">{route.surah.arabicName}</p></div>
          <p className="mt-1 text-xs text-muted-foreground">{route.surah.revelationType} · {route.surah.ayahCount} ayat</p>
          {route.surah.number !== 1 && route.surah.number !== 9 ? <p className="quran-arabic mt-6 text-[1.65rem] leading-[2] text-foreground" dir="rtl" lang="ar">{BISMILLAH}</p> : null}
        </header>
        <div>{ayahs.map((ayah) => <QuranAyahRow key={ayah.verseKey} ayah={ayah} surah={route.surah} current={currentAyah === ayah.ayahNumber} selected={selectedAyah === ayah.ayahNumber} audioStatus={audioPlayer.state.ayahNumber === ayah.ayahNumber ? audioPlayer.state.status : null} translationEnabled={preferences.translationEnabled} translation={translations.get(ayah.verseKey) ?? null} arabicFontPercent={preferences.arabicFontPercent} translationFontPercent={preferences.translationFontPercent} onSelect={select} onCopy={copy} onOpenTafsir={openTafsir} onToggleAudio={audioPlayer.toggleAyah} />)}</div>
      </main>
      <nav className="mx-auto mt-6 flex max-w-[980px] items-center justify-between gap-3 border-t border-border/60 pt-4" aria-label="Adjacent Surahs">
        {previous ? <Link href={`/quran/${previous.number}/1`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm font-semibold transition-colors hover:bg-muted"><ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block text-[9px] uppercase tracking-[0.13em] text-muted-foreground">Previous Surah</span><span className="block truncate">{previous.transliteratedName}</span></span></Link> : <span className="flex-1" />}
        {next ? <Link href={`/quran/${next.number}/1`} className="flex min-h-11 min-w-0 flex-1 items-center justify-end gap-2 rounded-lg px-2 text-right text-sm font-semibold transition-colors hover:bg-muted"><span className="min-w-0"><span className="block text-[9px] uppercase tracking-[0.13em] text-muted-foreground">Next Surah</span><span className="block truncate">{next.transliteratedName}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></Link> : <span className="flex-1" />}
      </nav>
      <QuranDisplayPanel open={displayOpen} onOpenChange={setDisplayOpen} arabicFontPercent={preferences.arabicFontPercent} audioReciters={audioReciters} audioRecitersLoading={audioRecitersLoading} selectedReciterId={selectedReciter.id} translationEnabled={preferences.translationEnabled} translationSource={preferences.translationSource} translationLoading={translationLoading} tafsirSourceId={preferences.tafsirSourceId} onArabicFontPercent={(percent) => preserveCurrentAyahDuringLayoutChange(() => updatePreferences({ arabicFontPercent: percent }))} onSelectReciter={(reciter) => { updatePreferences({ audioReciterId: reciter.id }); if (audioPlayer.isActive) audioPlayer.switchReciter(reciter); }} onToggleTranslation={() => preserveCurrentAyahDuringLayoutChange(() => updatePreferences({ translationEnabled: !preferences.translationEnabled }))} onSelectTranslation={(source) => preserveCurrentAyahDuringLayoutChange(() => updatePreferences({ translationSource: source }))} onSelectTafsir={selectTafsirSource} />
      <TafsirPanel open={Boolean(tafsirTarget)} ayah={tafsirTarget} surah={route.surah} selectedSourceId={preferences.tafsirSourceId} onSelectedSourceId={selectTafsirSource} onOpenChange={(open) => { if (!open) setTafsirAyah(null); }} />
      {audioPlayer.isActive ? <QuranAudioMiniPlayer state={audioPlayer.state} surah={route.surah} onPrevious={audioPlayer.previous} onToggle={audioPlayer.toggle} onNext={audioPlayer.next} onRetry={audioPlayer.retry} onStop={audioPlayer.stop} /> : null}
    </PageContainer>
  );
}
