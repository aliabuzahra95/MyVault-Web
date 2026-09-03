import type { QuranTranslationEntry } from "@/lib/quran/quranSupplementalData";

export function toggleSelectedAyah(currentAyah: number | null, requestedAyah: number) {
  return currentAyah === requestedAyah ? null : requestedAyah;
}

export function toggleExpandedFootnote(currentId: string | null, requestedId: string) {
  return currentId === requestedId ? null : requestedId;
}

export function quranReference(surahName: string, surahNumber: number, ayahNumber: number) {
  return `${surahName} ${surahNumber}:${ayahNumber}`;
}

export function quranCopyPayload(
  action: "arabic" | "translation" | "reference",
  values: { arabicText: string; translation: QuranTranslationEntry | null; reference: string },
) {
  if (action === "arabic") return values.arabicText;
  if (action === "translation") return values.translation?.text ?? "";
  return values.reference;
}

export function translationIsVisible(enabled: boolean, entry: QuranTranslationEntry | null | undefined) {
  return enabled && Boolean(entry?.text.trim());
}
