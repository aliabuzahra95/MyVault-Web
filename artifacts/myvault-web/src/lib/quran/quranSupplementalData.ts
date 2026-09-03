export const QURAN_FOUNDATION_PROXY = "https://quran-proxy.aliabuhassan1995-054.workers.dev";

export const QURAN_TRANSLATION_SOURCES = [
  {
    id: "sahih_international",
    name: "Sahih International",
    language: "English",
    description: "Clear English translation available fully offline.",
  },
  {
    id: "maududi",
    name: "Tafheem-ul-Quran",
    shortName: "Maududi",
    language: "English",
    description: "Sayyid Abul Ala Maududi, available offline with explanatory footnotes when available.",
  },
] as const;

export type QuranTranslationSourceId = typeof QURAN_TRANSLATION_SOURCES[number]["id"];

export type QuranTranslationFootnote = {
  id: string;
  label: string;
  text: string;
  markerStart: number;
  markerEndExclusive: number;
};

export type QuranTranslationEntry = {
  text: string;
  footnotes: QuranTranslationFootnote[];
};

export type QuranTafsirSource = {
  id: number;
  name: string;
  language: "English" | "Arabic";
  direction: "ltr" | "rtl";
  availability: "offline" | "online";
};

export const MUKHTASAR_TAFSIR_SOURCE: QuranTafsirSource = {
  id: -1,
  name: "Mukhtasar",
  language: "English",
  direction: "ltr",
  availability: "offline",
};

const EXPECTED_AYAH_COUNT = 6_236;
const MAUDUDI_TRANSLATION_RESOURCE_ID = 95;
const DESIRED_TAFSIRS = [
  { name: "Ibn Kathir", matcher: /ibn kathir/i, preferredLanguage: "english" },
  { name: "Al-Tabari", matcher: /tabari/i, preferredLanguage: "arabic" },
  { name: "Al-Qurtubi", matcher: /qurtubi/i, preferredLanguage: "arabic" },
] as const;

let sahihPromise: Promise<Map<string, QuranTranslationEntry>> | null = null;
let maududiPromise: Promise<Map<string, QuranTranslationEntry>> | null = null;
let mukhtasarPromise: Promise<Map<string, string>> | null = null;
let tafsirSourcesPromise: Promise<QuranTafsirSource[]> | null = null;
const maududiSurahPromises = new Map<number, Promise<Map<string, QuranTranslationEntry>>>();
const remoteTafsirPromises = new Map<string, Promise<string>>();

function publicAsset(path: string) {
  return `${import.meta.env.BASE_URL}${path}`;
}

function assertComplete<T>(entries: Map<string, T>, label: string) {
  if (entries.size !== EXPECTED_AYAH_COUNT) {
    throw new Error(`${label} contains ${entries.size} ayahs; ${EXPECTED_AYAH_COUNT} were expected.`);
  }
  return entries;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_, number: string) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function htmlToReaderText(rawHtml: string) {
  if (!rawHtml.trim()) return "";
  return decodeHtmlEntities(
    rawHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "</p>\n")
      .replace(/<\/div>/gi, "</div>\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replaceAll("\u00a0", " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseSahihInternational(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The Sahih International asset is not a verse-keyed object.");
  }
  const entries = new Map<string, QuranTranslationEntry>();
  for (const [verseKey, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const text = (value as { t?: unknown }).t;
    if (typeof text === "string" && text.trim()) {
      entries.set(verseKey, { text: text.trim(), footnotes: [] });
    }
  }
  return assertComplete(entries, "Sahih International");
}

export function parseBundledMaududi(rawText: string) {
  const entries = new Map<string, QuranTranslationEntry>();
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const firstSeparator = line.indexOf("|");
    const secondSeparator = line.indexOf("|", firstSeparator + 1);
    if (firstSeparator < 1 || secondSeparator < 0) continue;
    const surah = Number(line.slice(0, firstSeparator));
    const ayah = Number(line.slice(firstSeparator + 1, secondSeparator));
    const text = line.slice(secondSeparator + 1).trim();
    if (Number.isInteger(surah) && surah >= 1 && surah <= 114 && Number.isInteger(ayah) && ayah > 0 && text) {
      entries.set(`${surah}:${ayah}`, { text, footnotes: [] });
    }
  }
  return assertComplete(entries, "Tafheem-ul-Quran");
}

const FOOTNOTE_PATTERN = /<sup\b[^>]*foot_note\s*=\s*["']?(\d+)["']?[^>]*>(.*?)<\/sup>/gis;

export function parseMaududiRemoteEntry(rawHtml: string, footnoteValues: unknown): QuranTranslationEntry {
  const matches = [...rawHtml.matchAll(FOOTNOTE_PATTERN)];
  if (!matches.length) return { text: htmlToReaderText(rawHtml), footnotes: [] };

  const tokens = matches.map((_, index) => `MYVAULTFOOTNOTE${index}TOKEN`);
  let tokenIndex = 0;
  const templatedText = htmlToReaderText(rawHtml.replace(FOOTNOTE_PATTERN, () => tokens[tokenIndex++]));
  const footnoteRecord = footnoteValues && typeof footnoteValues === "object" && !Array.isArray(footnoteValues)
    ? footnoteValues as Record<string, unknown>
    : {};
  const footnotes: QuranTranslationFootnote[] = [];
  let cursor = 0;
  let text = "";

  matches.forEach((match, index) => {
    const token = tokens[index];
    const position = templatedText.indexOf(token, cursor);
    if (position < 0) return;
    text += templatedText.slice(cursor, position);
    const id = match[1];
    const label = htmlToReaderText(match[2]) || String(index + 1);
    const markerStart = text.length;
    text += label;
    const footnoteText = typeof footnoteRecord[id] === "string" ? htmlToReaderText(footnoteRecord[id]) : "";
    if (footnoteText) {
      footnotes.push({ id, label, text: footnoteText, markerStart, markerEndExclusive: text.length });
    }
    cursor = position + token.length;
  });
  text += templatedText.slice(cursor);
  return { text, footnotes };
}

type QuranFoundationTranslation = {
  verse_key?: unknown;
  text?: unknown;
  foot_notes?: unknown;
};

export function parseMaududiRemoteResponse(raw: unknown) {
  const entries = new Map<string, QuranTranslationEntry>();
  const translations = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { translations?: unknown }).translations
    : null;
  if (!Array.isArray(translations)) return entries;
  for (const value of translations) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const translation = value as QuranFoundationTranslation;
    if (typeof translation.verse_key !== "string" || typeof translation.text !== "string" || !translation.text.trim()) continue;
    entries.set(translation.verse_key, parseMaududiRemoteEntry(translation.text, translation.foot_notes));
  }
  return entries;
}

export function loadQuranTranslation(sourceId: QuranTranslationSourceId) {
  if (sourceId === "sahih_international") {
    sahihPromise ??= fetch(publicAsset("quran/Sahih_international.json"))
      .then((response) => {
        if (!response.ok) throw new Error("Sahih International could not be loaded.");
        return response.json() as Promise<unknown>;
      })
      .then(parseSahihInternational)
      .catch((error) => {
        sahihPromise = null;
        throw error;
      });
    return sahihPromise;
  }

  maududiPromise ??= fetch(publicAsset("quran/Maududi_en_tanzil.txt"))
    .then((response) => {
      if (!response.ok) throw new Error("Tafheem-ul-Quran could not be loaded.");
      return response.text();
    })
    .then(parseBundledMaududi)
    .catch((error) => {
      maududiPromise = null;
      throw error;
    });
  return maududiPromise;
}

export function loadMaududiFootnotes(surahNumber: number) {
  const existing = maududiSurahPromises.get(surahNumber);
  if (existing) return existing;
  const request = fetch(
    `${QURAN_FOUNDATION_PROXY}/proxy/content/api/v4/quran/translations/${MAUDUDI_TRANSLATION_RESOURCE_ID}` +
    `?chapter_number=${surahNumber}&foot_notes=true&fields=verse_key`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Maududi footnotes are temporarily unavailable.");
      return response.json() as Promise<unknown>;
    })
    .then(parseMaududiRemoteResponse)
    .catch((error) => {
      maududiSurahPromises.delete(surahNumber);
      throw error;
    });
  maududiSurahPromises.set(surahNumber, request);
  return request;
}

type QuranFoundationTafsirResource = {
  id?: unknown;
  name?: unknown;
  language_name?: unknown;
  translated_name?: { name?: unknown } | null;
};

export function selectEstablishedTafsirSources(raw: unknown) {
  const rows = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { tafsirs?: unknown }).tafsirs
    : null;
  if (!Array.isArray(rows)) return [MUKHTASAR_TAFSIR_SOURCE];
  const remoteSources = DESIRED_TAFSIRS.flatMap((desired) => {
    const matches = rows
      .filter((value): value is QuranFoundationTafsirResource => Boolean(value && typeof value === "object" && !Array.isArray(value)))
      .filter((value) => desired.matcher.test([
        value.name,
        value.translated_name?.name,
        value.language_name,
      ].filter((part): part is string => typeof part === "string").join(" ")))
      .filter((value) => typeof value.id === "number" && Number.isInteger(value.id))
      .toSorted((first, second) => {
        const firstPreferred = String(first.language_name).toLowerCase() === desired.preferredLanguage ? 1 : 0;
        const secondPreferred = String(second.language_name).toLowerCase() === desired.preferredLanguage ? 1 : 0;
        return secondPreferred - firstPreferred || Number(first.id) - Number(second.id);
      });
    const selected = matches[0];
    if (!selected) return [];
    const isArabic = String(selected.language_name).toLowerCase() === "arabic";
    return [{
      id: Number(selected.id),
      name: desired.name,
      language: isArabic ? "Arabic" as const : "English" as const,
      direction: isArabic ? "rtl" as const : "ltr" as const,
      availability: "online" as const,
    }];
  });
  return [...remoteSources, MUKHTASAR_TAFSIR_SOURCE];
}

export function loadTafsirSources() {
  tafsirSourcesPromise ??= fetch(`${QURAN_FOUNDATION_PROXY}/proxy/content/api/v4/resources/tafsirs?language=en`)
    .then((response) => {
      if (!response.ok) throw new Error("Online Tafsir sources are temporarily unavailable.");
      return response.json() as Promise<unknown>;
    })
    .then(selectEstablishedTafsirSources)
    .catch(() => [MUKHTASAR_TAFSIR_SOURCE]);
  return tafsirSourcesPromise;
}

export function parseMukhtasarTafsir(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The Mukhtasar Tafsir asset is not a verse-keyed object.");
  }
  const entries = new Map<string, string>();
  const rows = Object.entries(raw);
  if (rows.length !== EXPECTED_AYAH_COUNT) {
    throw new Error(`Mukhtasar Tafsir contains ${rows.length} ayah keys; ${EXPECTED_AYAH_COUNT} were expected.`);
  }
  for (const [verseKey, value] of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") entries.set(verseKey, text.trim());
  }
  return entries;
}

function loadMukhtasarTafsir() {
  mukhtasarPromise ??= fetch(publicAsset("quran/abridged_tafsir.json"))
    .then((response) => {
      if (!response.ok) throw new Error("Mukhtasar Tafsir could not be loaded.");
      return response.json() as Promise<unknown>;
    })
    .then(parseMukhtasarTafsir)
    .catch((error) => {
      mukhtasarPromise = null;
      throw error;
    });
  return mukhtasarPromise;
}

export function selectRemoteTafsirHtml(raw: unknown, sourceId: number) {
  const verse = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { verse?: unknown }).verse : null;
  const tafsirs = verse && typeof verse === "object" && !Array.isArray(verse) ? (verse as { tafsirs?: unknown }).tafsirs : null;
  if (!Array.isArray(tafsirs)) return "";
  return tafsirs
    .flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const row = value as { resource_id?: unknown; text?: unknown };
      return row.resource_id === sourceId && typeof row.text === "string" && row.text.trim() ? [row.text.trim()] : [];
    })
    .toSorted((first, second) => second.length - first.length)[0] ?? "";
}

export async function loadTafsir(verseKey: string, sourceId: number) {
  if (sourceId === MUKHTASAR_TAFSIR_SOURCE.id) {
    const text = (await loadMukhtasarTafsir()).get(verseKey) ?? "";
    if (!text) throw new Error("No Tafsir is available for this ayah in Mukhtasar.");
    return text;
  }
  const cacheKey = `${verseKey}|${sourceId}`;
  const existing = remoteTafsirPromises.get(cacheKey);
  if (existing) return existing;
  const request = fetch(
    `${QURAN_FOUNDATION_PROXY}/proxy/content/api/v4/verses/by_key/${verseKey}?language=en&tafsirs=${sourceId}`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("This online Tafsir could not be loaded.");
      return response.json() as Promise<unknown>;
    })
    .then((raw) => htmlToReaderText(selectRemoteTafsirHtml(raw, sourceId)))
    .then((text) => {
      if (!text) throw new Error("No Tafsir is available for this ayah in the selected source.");
      return text;
    })
    .catch((error) => {
      remoteTafsirPromises.delete(cacheKey);
      throw error;
    });
  remoteTafsirPromises.set(cacheKey, request);
  return request;
}
