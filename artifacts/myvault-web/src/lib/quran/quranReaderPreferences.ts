import { loadMetadataRestoreBundle } from "@/lib/restore/localRestoreStore";
import { getActiveAccountId, onActiveAccountChange } from "@/lib/sync/accountContext";
import type { QuranTranslationSourceId } from "@/lib/quran/quranSupplementalData";

export type QuranReaderPreferences = {
  schemaVersion: 1;
  arabicFontPercent: number;
  translationEnabled: boolean;
  translationSource: QuranTranslationSourceId;
  translationFontPercent: number;
  tafsirSourceId: number;
};

export const DEFAULT_QURAN_READER_PREFERENCES: QuranReaderPreferences = {
  schemaVersion: 1,
  arabicFontPercent: 100,
  translationEnabled: true,
  translationSource: "sahih_international",
  translationFontPercent: 100,
  tafsirSourceId: -1,
};

const STORAGE_PREFIX = "myvault-quran-reader-preferences-v1";
export const QURAN_READER_PREFERENCES_EVENT = "myvault-quran-reader-preferences-changed";

export function quranReaderPreferencesStorageKey(accountId = getActiveAccountId()) {
  return `${STORAGE_PREFIX}:${accountId}`;
}

function isTranslationSource(value: unknown): value is QuranTranslationSourceId {
  return value === "sahih_international" || value === "maududi";
}

function safeFontPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(130, Math.max(80, Math.round(value)))
    : 100;
}

function safeArabicFontPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(140, Math.max(70, Math.round(value)))
    : 100;
}

export function parseQuranReaderPreferences(value: unknown, requireSchemaVersion = true): QuranReaderPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (requireSchemaVersion && record.schemaVersion !== 1) return null;
  return {
    schemaVersion: 1,
    arabicFontPercent: safeArabicFontPercent(record.arabicFontPercent ?? record.quranArabicFontPercent),
    translationEnabled: typeof record.translationEnabled === "boolean"
      ? record.translationEnabled
      : typeof record.quranTranslationEnabled === "boolean"
        ? record.quranTranslationEnabled
        : true,
    translationSource: isTranslationSource(record.translationSource)
      ? record.translationSource
      : isTranslationSource(record.quranTranslationSource)
        ? record.quranTranslationSource
        : "sahih_international",
    translationFontPercent: safeFontPercent(record.translationFontPercent ?? record.quranTranslationFontPercent),
    tafsirSourceId: typeof (record.tafsirSourceId ?? record.quranTafsirSourceId) === "number"
      && Number.isInteger(record.tafsirSourceId ?? record.quranTafsirSourceId)
      ? Number(record.tafsirSourceId ?? record.quranTafsirSourceId)
      : -1,
  };
}

export function readLocalQuranReaderPreferences(accountId = getActiveAccountId()) {
  if (typeof localStorage === "undefined") return null;
  try {
    return parseQuranReaderPreferences(JSON.parse(localStorage.getItem(quranReaderPreferencesStorageKey(accountId)) ?? "null"));
  } catch {
    return null;
  }
}

export async function resolveQuranReaderPreferences() {
  const local = readLocalQuranReaderPreferences();
  if (local) return local;
  const bundle = await loadMetadataRestoreBundle();
  const settings = bundle?.files.find((file) => file.fileName === "settings.json")?.json;
  return parseQuranReaderPreferences(settings, false) ?? DEFAULT_QURAN_READER_PREFERENCES;
}

export function saveQuranReaderPreferences(preferences: QuranReaderPreferences, accountId = getActiveAccountId()) {
  if (typeof localStorage === "undefined") return;
  const validated = parseQuranReaderPreferences(preferences) ?? DEFAULT_QURAN_READER_PREFERENCES;
  localStorage.setItem(quranReaderPreferencesStorageKey(accountId), JSON.stringify(validated));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(QURAN_READER_PREFERENCES_EVENT, { detail: validated }));
  }
}

export function subscribeQuranReaderPreferences(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const refresh = () => listener();
  window.addEventListener(QURAN_READER_PREFERENCES_EVENT, refresh);
  window.addEventListener("myvault-restored-corpus-changed", refresh);
  const unsubscribeAccount = onActiveAccountChange(refresh);
  return () => {
    window.removeEventListener(QURAN_READER_PREFERENCES_EVENT, refresh);
    window.removeEventListener("myvault-restored-corpus-changed", refresh);
    unsubscribeAccount();
  };
}
