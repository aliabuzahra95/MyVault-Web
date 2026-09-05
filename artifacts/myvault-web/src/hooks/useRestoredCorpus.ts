import { useEffect, useState } from "react";
import { loadRestoredCorpus, type RestoredCorpus } from "@/lib/restore/restoredCorpus";
import { getActiveAccountId, onActiveAccountChange } from "@/lib/sync/accountContext";

export function useRestoredCorpus() {
  const [corpus, setCorpus] = useState<RestoredCorpus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let refreshId = 0;

    const refresh = () => {
      const requestId = ++refreshId;
      const accountId = getActiveAccountId();
      const current = () => !cancelled && requestId === refreshId && accountId === getActiveAccountId();
      void loadRestoredCorpus()
      .then((restoredCorpus) => {
        if (current()) {
          setCorpus(restoredCorpus);
        }
      })
      .catch(() => {
        if (current()) {
          setCorpus(null);
        }
      })
      .finally(() => {
        if (current()) {
          setIsLoading(false);
        }
      });
    };

    refresh();
    window.addEventListener("myvault-restored-corpus-changed", refresh);
    const unsubscribeAccount = onActiveAccountChange(() => {
      setCorpus(null);
      setIsLoading(true);
      refresh();
    });

    return () => {
      cancelled = true;
      window.removeEventListener("myvault-restored-corpus-changed", refresh);
      unsubscribeAccount();
    };
  }, []);

  return { corpus, isLoading, hasRestoredData: corpus !== null };
}
