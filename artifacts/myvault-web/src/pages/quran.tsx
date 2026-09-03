import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
  Hash,
  Loader2,
  MapPin,
  Search,
} from "lucide-react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Input } from "@/components/ui/input";
import { useQuranReadingPosition } from "@/hooks/useQuranReadingPosition";
import {
  loadQuranCorpus,
  safeQuranRoute,
  type QuranCorpus,
  type QuranSurah,
} from "@/lib/quran/quranData";
import { cn } from "@/lib/utils";

const BISMILLAH = "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ";

function useQuranCorpus() {
  const [corpus, setCorpus] = useState<QuranCorpus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadQuranCorpus()
      .then((value) => {
        if (!cancelled) setCorpus(value);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The Quran reader could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { corpus, error };
}

function QuranLoadingState() {
  return (
    <div className="flex min-h-[340px] items-center justify-center rounded-xl border border-border/70 bg-card" role="status">
      <div className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Loading the bundled Quran text
      </div>
    </div>
  );
}

function QuranErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-6">
      <h2 className="text-base font-semibold text-foreground">The Quran reader could not open</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
    </div>
  );
}

function SurahCard({ surah, isLastRead, lastReadAyah }: {
  surah: QuranSurah;
  isLastRead: boolean;
  lastReadAyah: number;
}) {
  const targetAyah = isLastRead ? Math.min(Math.max(lastReadAyah, 1), surah.ayahCount) : 1;
  return (
    <Link
      href={`/quran/${surah.number}/${targetAyah}`}
      className={cn(
        "group flex min-h-[104px] items-center gap-4 rounded-xl border bg-card px-4 py-4 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isLastRead ? "border-primary/30 bg-primary/[0.035]" : "border-border/70",
      )}
      data-testid={`quran-surah-${surah.number}`}
    >
      <span className="flex h-11 w-11 shrink-0 rotate-45 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-xs font-bold text-primary">
        <span className="-rotate-45 tabular-nums">{surah.number}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{surah.transliteratedName}</span>
          {isLastRead ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">Last read</span> : null}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{surah.translatedName}</span>
        <span className="mt-2 block text-[11px] font-medium text-muted-foreground">{surah.revelationType} · {surah.ayahCount} ayahs</span>
      </span>
      <span className="quran-arabic shrink-0 text-right text-[1.35rem] leading-loose text-foreground" dir="rtl" lang="ar">
        {surah.arabicName}
      </span>
    </Link>
  );
}

export default function QuranPage() {
  const { corpus, error } = useQuranCorpus();
  const { position } = useQuranReadingPosition();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const filteredSurahs = useMemo(() => {
    if (!corpus || !deferredQuery) return corpus?.surahs ?? [];
    return corpus.surahs.filter((surah) => (
      surah.transliteratedName.toLocaleLowerCase().includes(deferredQuery) ||
      surah.translatedName.toLocaleLowerCase().includes(deferredQuery) ||
      surah.arabicName.includes(deferredQuery) ||
      String(surah.number) === deferredQuery
    ));
  }, [corpus, deferredQuery]);
  const lastReadSurah = corpus?.surahs.find((surah) => surah.number === position?.surahNumber) ?? null;
  const lastReadAyah = lastReadSurah && position ? Math.min(Math.max(position.ayahNumber, 1), lastReadSurah.ayahCount) : 1;

  return (
    <PageContainer className="max-w-[1320px]">
      <PageHeader
        title="Quran"
        description="Read the complete Uthmani Hafs text using the same bundled Quran source as MyVault Android."
        actions={lastReadSurah ? (
          <Link href={`/quran/${lastReadSurah.number}/${lastReadAyah}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90">
            <BookOpen className="h-4 w-4" />
            Continue {lastReadSurah.transliteratedName} {lastReadSurah.number}:{lastReadAyah}
          </Link>
        ) : null}
      />

      <div className="mb-6 flex items-center gap-3 rounded-xl border border-border/70 bg-card px-4 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by Surah name or number"
          aria-label="Search Surahs"
          className="h-12 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          data-testid="quran-surah-search"
        />
      </div>

      {error ? <QuranErrorState message={error} /> : null}
      {!corpus && !error ? <QuranLoadingState /> : null}
      {corpus ? (
        <>
          <div className="mb-3 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{filteredSurahs.length} of 114 Surahs</span>
            <span>6,236 ayahs · bundled with MyVault</span>
          </div>
          {filteredSurahs.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredSurahs.map((surah) => (
                <SurahCard
                  key={surah.number}
                  surah={surah}
                  isLastRead={surah.number === position?.surahNumber}
                  lastReadAyah={position?.ayahNumber ?? 1}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No Surahs match “{query.trim()}”.</div>
          )}
        </>
      ) : null}
    </PageContainer>
  );
}

function ReaderHeader({ surah, currentAyah, onJump }: {
  surah: QuranSurah;
  currentAyah: number;
  onJump: (ayahNumber: number) => void;
}) {
  const [jumpValue, setJumpValue] = useState(String(currentAyah));

  useEffect(() => setJumpValue(String(currentAyah)), [currentAyah]);

  return (
    <div className="sticky top-0 z-20 -mx-5 border-b border-border/70 bg-background/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7 lg:-mx-10 lg:px-10">
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-3">
        <Link href="/quran" className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">All Surahs</span>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate text-lg font-bold text-foreground">{surah.transliteratedName}</h1>
            <span className="quran-arabic text-lg text-muted-foreground" dir="rtl" lang="ar">{surah.arabicName}</span>
          </div>
          <p className="text-xs font-medium text-muted-foreground">Ayah {currentAyah} of {surah.ayahCount}</p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const ayah = Number(jumpValue);
            if (Number.isInteger(ayah) && ayah >= 1 && ayah <= surah.ayahCount) onJump(ayah);
          }}
        >
          <label className="sr-only" htmlFor="quran-ayah-jump">Jump to ayah</label>
          <div className="flex h-9 items-center rounded-lg border border-border bg-card px-2">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              id="quran-ayah-jump"
              type="number"
              min={1}
              max={surah.ayahCount}
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value)}
              className="h-8 w-14 bg-transparent px-1 text-center text-sm font-semibold tabular-nums outline-none"
              data-testid="quran-ayah-jump"
            />
          </div>
          <button type="submit" className="flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90">Go</button>
        </form>
      </div>
    </div>
  );
}

export function QuranReaderPage() {
  const params = useParams<{ surah: string; ayah: string }>();
  const [, navigate] = useLocation();
  const { corpus, error } = useQuranCorpus();
  const { savePosition } = useQuranReadingPosition();
  const [currentAyah, setCurrentAyah] = useState(() => Number(params.ayah) || 1);
  const internalRouteKey = useRef<string | null>(null);
  const initialPositioning = useRef(true);
  const route = useMemo(
    () => corpus ? safeQuranRoute(corpus.surahs, params.surah, params.ayah) : null,
    [corpus, params.ayah, params.surah],
  );
  const ayahs = route ? corpus?.ayahsBySurah.get(route.surah.number) ?? [] : [];

  useEffect(() => {
    if (!route) return;
    const routeKey = `${route.surah.number}:${route.ayahNumber}`;
    setCurrentAyah(route.ayahNumber);
    if (internalRouteKey.current === routeKey) {
      internalRouteKey.current = null;
      return;
    }
    savePosition(route.surah.number, route.ayahNumber);
    initialPositioning.current = true;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`ayah-${route.ayahNumber}`)?.scrollIntoView({ block: "start" });
      requestAnimationFrame(() => {
        initialPositioning.current = false;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [route, savePosition]);

  useEffect(() => {
    if (!route || ayahs.length === 0) return;
    const elements = ayahs.map((ayah) => document.getElementById(`ayah-${ayah.ayahNumber}`)).filter((element): element is HTMLElement => Boolean(element));
    const observer = new IntersectionObserver((entries) => {
      if (initialPositioning.current) return;
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .toSorted((first, second) => Math.abs(first.boundingClientRect.top - 150) - Math.abs(second.boundingClientRect.top - 150))[0];
      const ayahNumber = Number((visible?.target as HTMLElement | undefined)?.dataset.ayah);
      if (!Number.isInteger(ayahNumber) || ayahNumber < 1 || ayahNumber > route.surah.ayahCount) return;
      setCurrentAyah((previous) => {
        if (previous === ayahNumber) return previous;
        const key = `${route.surah.number}:${ayahNumber}`;
        internalRouteKey.current = key;
        navigate(`/quran/${route.surah.number}/${ayahNumber}`, { replace: true });
        savePosition(route.surah.number, ayahNumber);
        return ayahNumber;
      });
    }, { rootMargin: "-118px 0px -58% 0px", threshold: [0, 0.2, 0.65] });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [ayahs, navigate, route, savePosition]);

  function jumpToAyah(ayahNumber: number) {
    if (!route) return;
    savePosition(route.surah.number, ayahNumber);
    navigate(`/quran/${route.surah.number}/${ayahNumber}`);
  }

  if (error) return <PageContainer><QuranErrorState message={error} /></PageContainer>;
  if (!corpus) return <PageContainer><QuranLoadingState /></PageContainer>;
  if (!route) {
    return (
      <PageContainer className="max-w-[760px]">
        <div className="rounded-xl border border-border bg-card p-7 text-center">
          <Compass className="mx-auto h-8 w-8 text-primary" />
          <h1 className="mt-4 text-lg font-semibold">That Quran reference does not exist</h1>
          <p className="mt-2 text-sm text-muted-foreground">Use a reference between 1:1 and 114:6.</p>
          <Link href="/quran" className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Choose a Surah</Link>
        </div>
      </PageContainer>
    );
  }

  const previousSurah = corpus.surahs[route.surah.number - 2] ?? null;
  const nextSurah = corpus.surahs[route.surah.number] ?? null;

  return (
    <PageContainer className="max-w-[1120px] pb-14 pt-0">
      <ReaderHeader surah={route.surah} currentAyah={currentAyah} onJump={jumpToAyah} />
      <div className="mx-auto mt-7 max-w-[960px] overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
        <header className="border-b border-border/65 bg-gradient-to-br from-primary/[0.08] via-card to-card px-6 py-8 text-center sm:px-10">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-card/80 text-sm font-bold text-primary shadow-sm">{route.surah.number}</div>
          <h2 className="mt-4 text-xl font-bold text-foreground">{route.surah.transliteratedName}</h2>
          <p className="quran-arabic mt-2 text-3xl leading-loose text-foreground" dir="rtl" lang="ar">{route.surah.arabicName}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{route.surah.revelationType} · {route.surah.ayahCount} ayahs</p>
          {route.surah.number !== 1 && route.surah.number !== 9 ? (
            <p className="quran-arabic mt-7 text-[1.75rem] leading-[2.2] text-foreground" dir="rtl" lang="ar">{BISMILLAH}</p>
          ) : null}
        </header>

        <div>
          {ayahs.map((ayah) => (
            <article
              key={ayah.verseKey}
              id={`ayah-${ayah.ayahNumber}`}
              data-ayah={ayah.ayahNumber}
              className={cn(
                "quran-ayah scroll-mt-28 border-b border-border/60 px-5 py-7 transition-colors last:border-b-0 sm:px-9 sm:py-9",
                currentAyah === ayah.ayahNumber ? "bg-primary/[0.055]" : "bg-card",
              )}
              aria-current={currentAyah === ayah.ayahNumber ? "location" : undefined}
              data-testid={`quran-ayah-${ayah.ayahNumber}`}
            >
              <div className="flex items-start gap-4 sm:gap-6">
                <Link
                  href={`/quran/${route.surah.number}/${ayah.ayahNumber}`}
                  className="mt-2 flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/5 px-2 text-xs font-bold tabular-nums text-primary hover:bg-primary/10"
                  aria-label={`Link to ${route.surah.transliteratedName} ayah ${ayah.ayahNumber}`}
                >
                  {ayah.ayahNumber}
                </Link>
                <p className="quran-arabic min-w-0 flex-1 text-right text-[clamp(1.85rem,4vw,2.55rem)] leading-[2.15] text-foreground" dir="rtl" lang="ar">
                  {ayah.arabicText}
                </p>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2 text-[11px] font-medium text-muted-foreground">
                {currentAyah === ayah.ayahNumber ? <><MapPin className="h-3.5 w-3.5 text-primary" /> Current reading position</> : `${route.surah.number}:${ayah.ayahNumber}`}
              </div>
            </article>
          ))}
        </div>
      </div>

      <nav className="mx-auto mt-5 flex max-w-[960px] items-stretch justify-between gap-3" aria-label="Adjacent Surahs">
        {previousSurah ? (
          <Link href={`/quran/${previousSurah.number}/1`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border border-border/70 bg-card px-4 text-sm font-semibold hover:border-primary/30">
            <ChevronLeft className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Previous</span><span className="block truncate">{previousSurah.transliteratedName}</span></span>
          </Link>
        ) : <span className="flex-1" />}
        {nextSurah ? (
          <Link href={`/quran/${nextSurah.number}/1`} className="flex min-h-14 min-w-0 flex-1 items-center justify-end gap-3 rounded-xl border border-border/70 bg-card px-4 text-right text-sm font-semibold hover:border-primary/30">
            <span className="min-w-0"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Next</span><span className="block truncate">{nextSurah.transliteratedName}</span></span>
            <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
          </Link>
        ) : <span className="flex-1" />}
      </nav>
      <div className="mx-auto mt-4 flex max-w-[960px] items-center justify-center gap-2 text-xs text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5" /> The address updates to the exact ayah as you read.
      </div>
    </PageContainer>
  );
}
