import { loadMetadataRestoreBundle } from "@/lib/restore/localRestoreStore";
import { getActiveAccountId, onActiveAccountChange } from "@/lib/sync/accountContext";

export type QuranReadingPosition = {
  schemaVersion: 1;
  surahNumber: number;
  ayahNumber: number;
  savedAt: number;
};

const STORAGE_PREFIX = "myvault-quran-last-read-v1";
export const QURAN_READING_POSITION_EVENT = "myvault-quran-reading-position-changed";

function storageKey() {
  return `${STORAGE_PREFIX}:${getActiveAccountId()}`;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validPosition(value: unknown): QuranReadingPosition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !isPositiveInteger(record.surahNumber) || !isPositiveInteger(record.ayahNumber)) return null;
  return {
    schemaVersion: 1,
    surahNumber: record.surahNumber,
    ayahNumber: record.ayahNumber,
    savedAt: typeof record.savedAt === "number" && Number.isFinite(record.savedAt) ? Math.max(0, record.savedAt) : 0,
  };
}

export function readLocalQuranPosition() {
  if (typeof localStorage === "undefined") return null;
  try {
    return validPosition(JSON.parse(localStorage.getItem(storageKey()) ?? "null"));
  } catch {
    return null;
  }
}

function restoredPosition(settings: unknown): QuranReadingPosition | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const record = settings as Record<string, unknown>;
  if (!isPositiveInteger(record.quranLastReadSurah) || !isPositiveInteger(record.quranLastReadAyah)) return null;
  const recentLocations = Array.isArray(record.quranRecentLocations) ? record.quranRecentLocations : [];
  const matchingRecent = recentLocations.find((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const recent = value as Record<string, unknown>;
    return recent.surahNumber === record.quranLastReadSurah && recent.ayahNumber === record.quranLastReadAyah;
  });
  const savedAt = matchingRecent && typeof matchingRecent === "object" && !Array.isArray(matchingRecent)
    && typeof (matchingRecent as Record<string, unknown>).lastReadAt === "number"
    ? Math.max(0, (matchingRecent as Record<string, number>).lastReadAt)
    : 0;
  return {
    schemaVersion: 1,
    surahNumber: record.quranLastReadSurah,
    ayahNumber: record.quranLastReadAyah,
    savedAt,
  };
}

export async function resolveQuranReadingPosition() {
  const local = readLocalQuranPosition();
  const bundle = await loadMetadataRestoreBundle();
  const settings = bundle?.files.find((file) => file.fileName === "settings.json")?.json;
  const restored = restoredPosition(settings);
  if (!local) return restored ?? { schemaVersion: 1, surahNumber: 1, ayahNumber: 1, savedAt: 0 };
  if (!restored) return local;
  return restored.savedAt > local.savedAt ? restored : local;
}

export function saveQuranReadingPosition(surahNumber: number, ayahNumber: number) {
  if (typeof localStorage === "undefined" || !isPositiveInteger(surahNumber) || !isPositiveInteger(ayahNumber)) return;
  const position: QuranReadingPosition = {
    schemaVersion: 1,
    surahNumber,
    ayahNumber,
    savedAt: Date.now(),
  };
  localStorage.setItem(storageKey(), JSON.stringify(position));
  window.dispatchEvent(new CustomEvent(QURAN_READING_POSITION_EVENT, { detail: position }));
}

export function subscribeQuranReadingPosition(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const handlePosition = () => listener();
  window.addEventListener(QURAN_READING_POSITION_EVENT, handlePosition);
  window.addEventListener("myvault-restored-corpus-changed", handlePosition);
  const unsubscribeAccount = onActiveAccountChange(listener);
  return () => {
    window.removeEventListener(QURAN_READING_POSITION_EVENT, handlePosition);
    window.removeEventListener("myvault-restored-corpus-changed", handlePosition);
    unsubscribeAccount();
  };
}
