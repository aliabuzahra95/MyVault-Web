import { QURAN_FOUNDATION_PROXY } from "@/lib/quran/quranSupplementalData";

export type QuranAudioReciter = {
  id: number;
  name: string;
};

export type QuranVerseAudioPage = {
  urls: Map<string, string>;
  nextPage: number | null;
};

export const FALLBACK_QURAN_RECITERS: QuranAudioReciter[] = [
  { id: 7, name: "Mishary al-Afasy" },
  { id: 3, name: "Abdur-Rahman as-Sudais" },
];

const DESIRED_RECITERS: ReadonlyArray<{ name: string; matcher: RegExp; preferredStyle?: string }> = [
  { name: "Abdul Basit (Mujawwad)", matcher: /abdul.?bas(et|it)/i, preferredStyle: "Mujawwad" },
  { name: "Abdul Basit (Murattal)", matcher: /abdul.?bas(et|it)/i, preferredStyle: "Murattal" },
  { name: "Abdur-Rahman as-Sudais", matcher: /sudais/i },
  { name: "Abu Bakr al-Shatri", matcher: /shatri/i },
  { name: "Hani ar-Rifai", matcher: /rifai/i },
  { name: "Husary", matcher: /husary/i },
  { name: "Husary (Muallim)", matcher: /husary/i, preferredStyle: "Muallim" },
  { name: "Mishary al-Afasy", matcher: /mishari|mishary|afasy/i },
  { name: "Mohamed Siddiq al-Minshawi (Mujawwad)", matcher: /minshawi/i, preferredStyle: "Mujawwad" },
  { name: "Mohamed Siddiq al-Minshawi (Murattal)", matcher: /minshawi/i, preferredStyle: "Murattal" },
  { name: "Sa`ud ash-Shuraym", matcher: /shuraym|shuraim/i },
  { name: "Mohamed al-Tablawi", matcher: /tablawi/i },
];

type RawRecitation = {
  id?: unknown;
  reciter_name?: unknown;
  style?: unknown;
  translated_name?: { name?: unknown } | null;
};

function searchableReciterName(reciter: RawRecitation) {
  return [reciter.reciter_name, reciter.translated_name?.name, reciter.style]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

export function selectSupportedReciters(raw: unknown): QuranAudioReciter[] {
  const values = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { recitations?: unknown }).recitations
    : null;
  if (!Array.isArray(values)) return [];
  const rows = values.filter((value): value is RawRecitation => Boolean(value && typeof value === "object" && !Array.isArray(value)));
  return DESIRED_RECITERS.flatMap((desired) => {
    const selected = rows
      .filter((row) => typeof row.id === "number" && Number.isInteger(row.id) && desired.matcher.test(searchableReciterName(row)))
      .toSorted((first, second) => {
        const firstPreferred = first.style === desired.preferredStyle ? 1 : 0;
        const secondPreferred = second.style === desired.preferredStyle ? 1 : 0;
        return secondPreferred - firstPreferred || Number(first.id) - Number(second.id);
      })[0];
    return selected ? [{ id: Number(selected.id), name: desired.name }] : [];
  });
}

let recitersPromise: Promise<QuranAudioReciter[]> | null = null;

export function loadSupportedReciters() {
  recitersPromise ??= fetch(`${QURAN_FOUNDATION_PROXY}/proxy/content/api/v4/resources/recitations?language=en`)
    .then((response) => {
      if (!response.ok) throw new Error("Reciters are temporarily unavailable.");
      return response.json() as Promise<unknown>;
    })
    .then((raw) => selectSupportedReciters(raw))
    .then((reciters) => reciters.length ? reciters : FALLBACK_QURAN_RECITERS)
    .catch(() => FALLBACK_QURAN_RECITERS);
  return recitersPromise;
}

export function verseAudioRequestUrl(reciterId: number, surahNumber: number, page: number) {
  return `${QURAN_FOUNDATION_PROXY}/proxy/content/api/v4/verses/by_chapter/${surahNumber}`
    + `?language=en&audio=${reciterId}&fields=verse_key&per_page=50&page=${page}`;
}

export function resolveQuranAudioUrl(rawUrl: string) {
  const value = rawUrl.trim();
  if (value.startsWith("https://")) return value;
  if (value.startsWith("http://")) return `https://${value.slice("http://".length)}`;
  if (value.startsWith("//")) return `https:${value}`;
  return `https://verses.quran.com/${value.replace(/^\/+/, "")}`;
}

export function parseVerseAudioPage(raw: unknown): QuranVerseAudioPage {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const verses = Array.isArray(record.verses) ? record.verses : [];
  const urls = new Map<string, string>();
  for (const value of verses) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const verse = value as { verse_key?: unknown; audio?: { url?: unknown } | null };
    if (typeof verse.verse_key === "string" && typeof verse.audio?.url === "string" && verse.audio.url.trim()) {
      urls.set(verse.verse_key, resolveQuranAudioUrl(verse.audio.url));
    }
  }
  const nextPageValue = record.pagination && typeof record.pagination === "object" && !Array.isArray(record.pagination)
    ? (record.pagination as { next_page?: unknown }).next_page
    : null;
  return { urls, nextPage: typeof nextPageValue === "number" && Number.isInteger(nextPageValue) && nextPageValue > 0 ? nextPageValue : null };
}

export async function loadVerseAudioPage(reciterId: number, surahNumber: number, page: number, signal?: AbortSignal) {
  const response = await fetch(verseAudioRequestUrl(reciterId, surahNumber, page), { signal });
  if (!response.ok) throw new Error(`Audio could not be loaded (${response.status}).`);
  return parseVerseAudioPage(await response.json() as unknown);
}

export function audioPageForAyah(ayahNumber: number) {
  return Math.floor((Math.max(1, ayahNumber) - 1) / 50) + 1;
}

export function nextAudioAyah(currentAyah: number, ayahCount: number, direction: -1 | 1) {
  const next = currentAyah + direction;
  return next >= 1 && next <= ayahCount ? next : null;
}
