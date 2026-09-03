import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, ArrowRight, BookText, Check, ChevronLeft, ChevronRight, Compass, Copy, Hash, Languages, Loader2, MapPin } from "lucide-react";
import { PageContainer } from "@/components/page-layout";
import { QuranErrorState, QuranLoadingState, useQuranCorpus } from "@/components/quran/quran-shared";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuranReaderPreferences } from "@/hooks/useQuranReaderPreferences";
import { useQuranReadingPosition } from "@/hooks/useQuranReadingPosition";
import { useToast } from "@/hooks/use-toast";
import { safeQuranRoute, type QuranAyah, type QuranSurah } from "@/lib/quran/quranData";
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

function ReaderHeader({ surah, currentAyah, onJump, translationEnabled, translationSource, translationLoading, onToggleTranslation, onSelectTranslation }: {
  surah: QuranSurah;
  currentAyah: number;
  onJump: (ayahNumber: number) => void;
  translationEnabled: boolean;
  translationSource: QuranTranslationSourceId;
  translationLoading: boolean;
  onToggleTranslation: () => void;
  onSelectTranslation: (source: QuranTranslationSourceId) => void;
}) {
  const [jumpValue, setJumpValue] = useState(String(currentAyah));
  useEffect(() => setJumpValue(String(currentAyah)), [currentAyah]);
  return (
    <div className="sticky top-0 z-20 -mx-5 border-b border-border/70 bg-background/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7 lg:-mx-10 lg:px-10">
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-2.5">
        <Link href="/quran" className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">All Surahs</span>
        </Link>
        <div className="min-w-[130px] flex-1">
          <div className="flex items-baseline gap-2"><h1 className="truncate text-lg font-bold text-foreground">{surah.transliteratedName}</h1><span className="quran-arabic text-lg text-muted-foreground" dir="rtl" lang="ar">{surah.arabicName}</span></div>
          <p className="text-xs font-medium text-muted-foreground">Ayah {currentAyah} of {surah.ayahCount}</p>
        </div>
        <div className="order-3 flex w-full items-center gap-2 sm:order-none sm:w-auto">
          <button type="button" onClick={onToggleTranslation} className={cn("inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors sm:flex-none", translationEnabled ? "border-primary/30 bg-primary/[0.08] text-primary" : "border-border bg-card text-muted-foreground")} aria-pressed={translationEnabled} data-testid="quran-translation-toggle">
            <Languages className="h-3.5 w-3.5" /> Translation {translationEnabled ? "On" : "Off"}
          </button>
          <label className="sr-only" htmlFor="quran-translation-source">Translation source</label>
          <select id="quran-translation-source" value={translationSource} onChange={(event) => onSelectTranslation(event.target.value as QuranTranslationSourceId)} disabled={translationLoading} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring sm:w-[164px]" data-testid="quran-translation-source">
            {QURAN_TRANSLATION_SOURCES.map((source) => <option key={source.id} value={source.id}>{"shortName" in source ? source.shortName : source.name}</option>)}
          </select>
        </div>
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); const ayah = Number(jumpValue); if (Number.isInteger(ayah) && ayah >= 1 && ayah <= surah.ayahCount) onJump(ayah); }}>
          <label className="sr-only" htmlFor="quran-ayah-jump">Jump to ayah</label>
          <div className="flex h-9 items-center rounded-lg border border-border bg-card px-2"><Hash className="h-3.5 w-3.5 text-muted-foreground" /><input id="quran-ayah-jump" type="number" min={1} max={surah.ayahCount} value={jumpValue} onChange={(event) => setJumpValue(event.target.value)} className="h-8 w-12 bg-transparent px-1 text-center text-sm font-semibold tabular-nums outline-none" data-testid="quran-ayah-jump" /></div>
          <button type="submit" className="flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90">Go</button>
        </form>
      </div>
    </div>
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
    <div className="mt-4 border-l-2 border-border/70 pl-4 sm:ml-14 sm:pl-5" dir="ltr" lang="en">
      <p className="text-muted-foreground" style={{ fontSize: `${0.95 * Math.min(130, Math.max(80, fontPercent)) / 100}rem`, lineHeight: 1.72 }} data-testid="quran-translation-text">{parts}</p>
      {expanded ? <div className="mt-3 animate-in rounded-xl border border-border/80 bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground fade-in slide-in-from-top-1 duration-150" onClick={(event) => event.stopPropagation()} data-testid={`quran-footnote-content-${expanded.label}`}><div className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-primary">Footnote {expanded.label}</div>{expanded.text}</div> : null}
    </div>
  );
}

type AyahRowProps = {
  ayah: QuranAyah;
  surah: QuranSurah;
  current: boolean;
  selected: boolean;
  translationEnabled: boolean;
  translation: QuranTranslationEntry | null;
  translationFontPercent: number;
  onSelect: (ayahNumber: number) => void;
  onCopy: (action: "arabic" | "translation" | "reference", ayah: QuranAyah, translation: QuranTranslationEntry | null) => void;
  onOpenTafsir: (ayah: QuranAyah) => void;
};

const QuranAyahRow = memo(function QuranAyahRow({ ayah, surah, current, selected, translationEnabled, translation, translationFontPercent, onSelect, onCopy, onOpenTafsir }: AyahRowProps) {
  const reference = quranReference(surah.transliteratedName, surah.number, ayah.ayahNumber);
  const showTranslation = translationIsVisible(translationEnabled, translation);
  const select = () => onSelect(ayah.ayahNumber);
  const nestedControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("button, a, select, input"));
  return (
    <article id={`ayah-${ayah.ayahNumber}`} data-ayah={ayah.ayahNumber} className={cn("quran-ayah relative scroll-mt-44 border-b border-border/60 px-5 py-7 transition-[background-color,box-shadow] duration-150 last:border-b-0 sm:px-9 sm:py-9", current ? "bg-primary/[0.04]" : "bg-card", selected && "z-[1] bg-primary/[0.075] shadow-[inset_3px_0_0_hsl(var(--primary))] dark:bg-primary/[0.09]")} aria-current={current ? "location" : undefined} aria-label={`${reference}${selected ? ", selected" : ""}. Select for ayah actions.`} tabIndex={0} onClick={(event) => { if (!nestedControl(event.target)) select(); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); select(); } }} data-selected={selected ? "true" : "false"} data-testid={`quran-ayah-${ayah.ayahNumber}`}>
      <div className="flex items-start gap-4 sm:gap-6">
        <Link href={`/quran/${surah.number}/${ayah.ayahNumber}`} className="mt-2 flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/5 px-2 text-xs font-bold tabular-nums text-primary hover:bg-primary/10" aria-label={`Link to ${surah.transliteratedName} ayah ${ayah.ayahNumber}`}>{ayah.ayahNumber}</Link>
        <p className="quran-arabic min-w-0 flex-1 text-right text-[clamp(1.85rem,4vw,2.55rem)] leading-[2.15] text-foreground" dir="rtl" lang="ar">{ayah.arabicText}</p>
      </div>
      {showTranslation && translation ? <TranslationText entry={translation} fontPercent={translationFontPercent} /> : null}
      <div className="mt-3 flex items-center justify-end gap-2 text-[11px] font-medium text-muted-foreground">{current ? <><MapPin className="h-3.5 w-3.5 text-primary" /> Current reading position</> : `${surah.number}:${ayah.ayahNumber}`}</div>
      {selected ? (
        <div className="mt-4 flex animate-in flex-wrap items-center gap-2 border-t border-primary/15 pt-3 fade-in slide-in-from-top-1 duration-150" role="toolbar" aria-label={`Actions for ${reference}`} data-testid="quran-ayah-toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => onOpenTafsir(ayah)} className="quran-action-button" data-testid="quran-open-tafsir"><BookText className="h-3.5 w-3.5" /> Tafsir</button>
          <button type="button" onClick={() => onCopy("arabic", ayah, translation)} className="quran-action-button" data-testid="quran-copy-arabic"><Copy className="h-3.5 w-3.5" /> Arabic</button>
          {showTranslation ? <button type="button" onClick={() => onCopy("translation", ayah, translation)} className="quran-action-button" data-testid="quran-copy-translation"><Languages className="h-3.5 w-3.5" /> Translation</button> : null}
          <button type="button" onClick={() => onCopy("reference", ayah, translation)} className="quran-action-button" data-testid="quran-copy-reference"><Hash className="h-3.5 w-3.5" /> Reference</button>
          <span className="ml-auto hidden items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary sm:flex"><Check className="h-3 w-3" /> Selected</span>
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
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("flex flex-col gap-0 overflow-hidden border-border bg-background p-0", isMobile ? "h-[92dvh] rounded-t-2xl" : "w-[min(520px,46vw)] sm:max-w-[520px]")} data-testid="quran-tafsir-panel">
        <SheetHeader className="border-b border-border/70 px-5 pb-4 pt-5 text-left sm:px-6">
          <div className="pr-10 text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary">Tafsir</div>
          <SheetTitle className="pr-10 text-xl">{reference}</SheetTitle>
          <SheetDescription>{surah.arabicName} · {ayah ? `Ayah ${ayah.ayahNumber}` : "Selected ayah"}</SheetDescription>
          <div className="pt-2"><label htmlFor="quran-tafsir-source" className="mb-1.5 block text-xs font-semibold text-muted-foreground">Source</label><select id="quran-tafsir-source" value={source.id} onChange={(event) => onSelectedSourceId(Number(event.target.value))} disabled={!sourcesReady} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring" data-testid="quran-tafsir-source">{sources.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.language}{item.availability === "offline" ? " · Offline" : ""}</option>)}</select></div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6" data-testid="quran-tafsir-scroll">
          {!sourcesReady || loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm font-medium text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading {source.name}</div> : null}
          {error ? <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm leading-6 text-muted-foreground" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">Try again</button></div> : null}
          {!loading && !error && content ? <div className={cn("whitespace-pre-wrap text-[0.98rem] leading-7 text-foreground", source.direction === "rtl" && "quran-tafsir-arabic text-right text-[1.08rem] leading-8")} dir={source.direction} lang={source.language === "Arabic" ? "ar" : "en"} data-testid="quran-tafsir-content">{content}</div> : null}
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
  const [translations, setTranslations] = useState(EMPTY_TRANSLATIONS);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationMessage, setTranslationMessage] = useState<string | null>(null);
  const internalRouteKey = useRef<string | null>(null);
  const initialPositioning = useRef(true);
  const layoutObserverSuppressed = useRef(false);
  const layoutChangeVersion = useRef(0);
  const layoutAnchorAyah = useRef(currentAyah);
  const currentAyahRef = useRef(currentAyah);
  const readingNavigationIntentUntil = useRef(0);
  const route = useMemo(() => corpus ? safeQuranRoute(corpus.surahs, params.surah, params.ayah) : null, [corpus, params.ayah, params.surah]);
  const ayahs = route ? corpus?.ayahsBySurah.get(route.surah.number) ?? [] : [];
  const surahNumber = route?.surah.number;
  const surahNumberRef = useRef(surahNumber);
  surahNumberRef.current = surahNumber;

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
    const markReadingNavigationIntent = () => { readingNavigationIntentUntil.current = Date.now() + 1200; };
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
    const elements = ayahs.map((ayah) => document.getElementById(`ayah-${ayah.ayahNumber}`)).filter((element): element is HTMLElement => Boolean(element));
    const observer = new IntersectionObserver(() => {
      if (initialPositioning.current || layoutObserverSuppressed.current || Date.now() > readingNavigationIntentUntil.current) return;
      const visible = elements
        .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
        .filter(({ bounds }) => bounds.bottom > 170 && bounds.top < window.innerHeight * 0.55)
        .toSorted((a, b) => Math.abs(a.bounds.top - 176) - Math.abs(b.bounds.top - 176))[0];
      const ayah = Number(visible?.element.dataset.ayah);
      if (!Number.isInteger(ayah) || ayah < 1 || ayah > route.surah.ayahCount) return;
      if (currentAyahRef.current === ayah) return;
      currentAyahRef.current = ayah;
      setCurrentAyah(ayah);
      internalRouteKey.current = `${route.surah.number}:${ayah}`;
      navigate(`/quran/${route.surah.number}/${ayah}`, { replace: true });
      savePosition(route.surah.number, ayah);
    }, { rootMargin: "-170px 0px -55% 0px", threshold: [0, 0.2, 0.65] });
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
    <PageContainer className="max-w-[1120px] pb-14 pt-0">
      <ReaderHeader surah={route.surah} currentAyah={currentAyah} onJump={jump} translationEnabled={preferences.translationEnabled} translationSource={preferences.translationSource} translationLoading={translationLoading} onToggleTranslation={() => preserveCurrentAyahDuringLayoutChange(() => updatePreferences({ translationEnabled: !preferences.translationEnabled }))} onSelectTranslation={(source) => preserveCurrentAyahDuringLayoutChange(() => updatePreferences({ translationSource: source }))} />
      {preferences.translationEnabled && translationLoading ? <div className="mx-auto mt-3 flex max-w-[960px] items-center gap-2 px-1 text-xs font-medium text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Loading {QURAN_TRANSLATION_SOURCES.find((source) => source.id === preferences.translationSource)?.name}</div> : null}
      {translationMessage ? <p className="mx-auto mt-3 max-w-[960px] px-1 text-xs font-medium text-muted-foreground" role="status">{translationMessage}</p> : null}
      <div className="mx-auto mt-7 max-w-[960px] overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
        <header className="border-b border-border/65 bg-gradient-to-br from-primary/[0.08] via-card to-card px-6 py-8 text-center sm:px-10"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-card/80 text-sm font-bold text-primary shadow-sm">{route.surah.number}</div><h2 className="mt-4 text-xl font-bold text-foreground">{route.surah.transliteratedName}</h2><p className="quran-arabic mt-2 text-3xl leading-loose text-foreground" dir="rtl" lang="ar">{route.surah.arabicName}</p><p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{route.surah.revelationType} · {route.surah.ayahCount} ayahs</p>{route.surah.number !== 1 && route.surah.number !== 9 ? <p className="quran-arabic mt-7 text-[1.75rem] leading-[2.2] text-foreground" dir="rtl" lang="ar">{BISMILLAH}</p> : null}</header>
        <div>{ayahs.map((ayah) => <QuranAyahRow key={ayah.verseKey} ayah={ayah} surah={route.surah} current={currentAyah === ayah.ayahNumber} selected={selectedAyah === ayah.ayahNumber} translationEnabled={preferences.translationEnabled} translation={translations.get(ayah.verseKey) ?? null} translationFontPercent={preferences.translationFontPercent} onSelect={select} onCopy={copy} onOpenTafsir={openTafsir} />)}</div>
      </div>
      <nav className="mx-auto mt-5 flex max-w-[960px] items-stretch justify-between gap-3" aria-label="Adjacent Surahs">
        {previous ? <Link href={`/quran/${previous.number}/1`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border border-border/70 bg-card px-4 text-sm font-semibold hover:border-primary/30"><ChevronLeft className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Previous</span><span className="block truncate">{previous.transliteratedName}</span></span></Link> : <span className="flex-1" />}
        {next ? <Link href={`/quran/${next.number}/1`} className="flex min-h-14 min-w-0 flex-1 items-center justify-end gap-3 rounded-xl border border-border/70 bg-card px-4 text-right text-sm font-semibold hover:border-primary/30"><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Next</span><span className="block truncate">{next.transliteratedName}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-primary" /></Link> : <span className="flex-1" />}
      </nav>
      <div className="mx-auto mt-4 flex max-w-[960px] items-center justify-center gap-2 text-xs text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" /> The address updates to the exact ayah as you read.</div>
      <TafsirPanel open={Boolean(tafsirTarget)} ayah={tafsirTarget} surah={route.surah} selectedSourceId={preferences.tafsirSourceId} onSelectedSourceId={selectTafsirSource} onOpenChange={(open) => { if (!open) setTafsirAyah(null); }} />
    </PageContainer>
  );
}
