import { useDeferredValue, useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { Link } from "wouter";
import { QuranReaderPage } from "@/components/quran/quran-reader";
import { QuranErrorState, QuranLoadingState, useQuranCorpus } from "@/components/quran/quran-shared";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Input } from "@/components/ui/input";
import { useQuranReadingPosition } from "@/hooks/useQuranReadingPosition";
import type { QuranSurah } from "@/lib/quran/quranData";
import { cn } from "@/lib/utils";

export { QuranReaderPage };

function SurahCard({ surah, isLastRead, lastReadAyah }: { surah: QuranSurah; isLastRead: boolean; lastReadAyah: number }) {
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
      <span className="quran-arabic shrink-0 text-right text-[1.35rem] leading-loose text-foreground" dir="rtl" lang="ar">{surah.arabicName}</span>
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
    <PageContainer className="max-w-[1320px]">
      <PageHeader
        title="Quran"
        description="Read the complete Uthmani Hafs text using the same bundled Quran source as MyVault Android."
        actions={lastReadSurah ? (
          <Link href={`/quran/${lastReadSurah.number}/${lastReadAyah}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90">
            <BookOpen className="h-4 w-4" /> Continue {lastReadSurah.transliteratedName} {lastReadSurah.number}:{lastReadAyah}
          </Link>
        ) : null}
      />
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-border/70 bg-card px-4 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by Surah name or number" aria-label="Search Surahs" className="h-12 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" data-testid="quran-surah-search" />
      </div>
      {error ? <QuranErrorState message={error} /> : null}
      {!corpus && !error ? <QuranLoadingState /> : null}
      {corpus ? (
        <>
          <div className="mb-3 flex items-center justify-between text-xs font-medium text-muted-foreground"><span>{filteredSurahs.length} of 114 Surahs</span><span>6,236 ayahs · bundled with MyVault</span></div>
          {filteredSurahs.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredSurahs.map((surah) => <SurahCard key={surah.number} surah={surah} isLastRead={surah.number === position?.surahNumber} lastReadAyah={position?.ayahNumber ?? 1} />)}
            </div>
          ) : <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No Surahs match “{query.trim()}”.</div>}
        </>
      ) : null}
    </PageContainer>
  );
}
