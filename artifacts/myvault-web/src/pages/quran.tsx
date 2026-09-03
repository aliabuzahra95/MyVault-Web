import { useDeferredValue, useMemo, useState } from "react";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import { Link } from "wouter";
import { QuranReaderPage } from "@/components/quran/quran-reader";
import { QuranErrorState, QuranLoadingState, useQuranCorpus } from "@/components/quran/quran-shared";
import { PageContainer } from "@/components/page-layout";
import { Input } from "@/components/ui/input";
import { useQuranReadingPosition } from "@/hooks/useQuranReadingPosition";
import type { QuranSurah } from "@/lib/quran/quranData";
import { cn } from "@/lib/utils";

export { QuranReaderPage };

function SurahRow({ surah, isLastRead, lastReadAyah }: { surah: QuranSurah; isLastRead: boolean; lastReadAyah: number }) {
  const targetAyah = isLastRead ? Math.min(Math.max(lastReadAyah, 1), surah.ayahCount) : 1;
  return (
    <Link
      href={`/quran/${surah.number}/${targetAyah}`}
      className={cn(
        "group grid min-h-[78px] grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/65 px-2 py-3.5 transition-colors duration-150 hover:bg-muted/45 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3",
        isLastRead && "border-l-2 border-l-primary bg-primary/[0.025]",
      )}
      data-testid={`quran-surah-${surah.number}`}
    >
      <span className="text-center text-xs font-semibold tabular-nums text-muted-foreground group-hover:text-primary">{surah.number}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-[0.94rem] font-semibold text-foreground">{surah.transliteratedName}</span>
          {isLastRead ? <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-primary">Last read</span> : null}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{surah.translatedName} · {surah.revelationType} · {surah.ayahCount} ayat</span>
      </span>
      <span className="quran-arabic min-w-[5rem] shrink-0 text-right text-[1.28rem] leading-loose text-foreground" dir="rtl" lang="ar">{surah.arabicName}</span>
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
      surah.transliteratedName.toLocaleLowerCase().includes(deferredQuery)
      || surah.translatedName.toLocaleLowerCase().includes(deferredQuery)
      || surah.arabicName.includes(deferredQuery)
      || String(surah.number) === deferredQuery
    ));
  }, [corpus, deferredQuery]);
  const lastReadSurah = corpus?.surahs.find((surah) => surah.number === position?.surahNumber) ?? null;
  const lastReadAyah = lastReadSurah && position ? Math.min(Math.max(position.ayahNumber, 1), lastReadSurah.ayahCount) : 1;

  return (
    <PageContainer className="max-w-[1180px] pb-16">
      <header className="mb-8 flex flex-col gap-5 border-b border-border/60 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.19em] text-primary">MyVault Reader</p>
          <h1 className="text-3xl font-semibold tracking-[-0.025em] text-foreground">Qur’an</h1>
        </div>
        {lastReadSurah ? (
          <Link href={`/quran/${lastReadSurah.number}/${lastReadAyah}`} className="group flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="quran-continue-reading">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><BookOpen className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Continue reading</span>
              <span className="block truncate text-sm font-semibold text-foreground">{lastReadSurah.transliteratedName} · {lastReadSurah.number}:{lastReadAyah}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>
        ) : null}
      </header>

      <section aria-labelledby="surahs-heading">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="surahs-heading" className="text-lg font-semibold text-foreground">Surahs</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{filteredSurahs.length} of 114</p>
          </div>
          <label className="flex h-10 w-full items-center gap-2 border-b border-border px-1 transition-colors focus-within:border-primary sm:w-[360px]" htmlFor="quran-surah-search">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input id="quran-surah-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Surahs" aria-label="Search Surahs" className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" data-testid="quran-surah-search" />
          </label>
        </div>

        {error ? <QuranErrorState message={error} /> : null}
        {!corpus && !error ? <QuranLoadingState /> : null}
        {corpus ? (
          filteredSurahs.length ? (
            <div className="grid border-t border-border/65 md:grid-cols-2 md:gap-x-8" data-testid="quran-compact-surah-list">
              {filteredSurahs.map((surah) => <SurahRow key={surah.number} surah={surah} isLastRead={surah.number === position?.surahNumber} lastReadAyah={position?.ayahNumber ?? 1} />)}
            </div>
          ) : <div className="border-y border-dashed border-border py-14 text-center text-sm text-muted-foreground">No Surahs match “{query.trim()}”.</div>
        ) : null}
      </section>
    </PageContainer>
  );
}
