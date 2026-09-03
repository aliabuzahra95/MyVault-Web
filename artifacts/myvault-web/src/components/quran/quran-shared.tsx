import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadQuranCorpus, type QuranCorpus } from "@/lib/quran/quranData";

export function useQuranCorpus() {
  const [corpus, setCorpus] = useState<QuranCorpus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadQuranCorpus()
      .then((value) => { if (!cancelled) setCorpus(value); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "The Quran reader could not be loaded."); });
    return () => { cancelled = true; };
  }, []);
  return { corpus, error };
}

export function QuranLoadingState() {
  return <div className="flex min-h-[340px] items-center justify-center rounded-xl border border-border/70 bg-card" role="status"><div className="flex items-center gap-3 text-sm font-medium text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading the bundled Quran text</div></div>;
}

export function QuranErrorState({ message }: { message: string }) {
  return <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-6"><h2 className="text-base font-semibold text-foreground">The Quran reader could not open</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p></div>;
}
