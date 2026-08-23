import { useEffect, useState } from "react";
import { loadRestoredCorpus, type RestoredCorpus } from "@/lib/restore/restoredCorpus";

export function useRestoredCorpus() {
  const [corpus, setCorpus] = useState<RestoredCorpus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => void loadRestoredCorpus()
      .then((restoredCorpus) => {
        if (!cancelled) {
          setCorpus(restoredCorpus);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCorpus(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    refresh();
    window.addEventListener("myvault-restored-corpus-changed", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("myvault-restored-corpus-changed", refresh);
    };
  }, []);

  return { corpus, isLoading, hasRestoredData: corpus !== null };
}
