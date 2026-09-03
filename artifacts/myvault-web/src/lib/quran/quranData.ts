export type QuranSurah = {
  number: number;
  ayahCount: number;
  arabicName: string;
  transliteratedName: string;
  translatedName: string;
  revelationType: "Meccan" | "Medinan";
};

export type QuranAyah = {
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  arabicText: string;
};

export type QuranCorpus = {
  surahs: QuranSurah[];
  ayahsBySurah: Map<number, QuranAyah[]>;
};

type QpcHafsRow = {
  verse_key?: unknown;
  surah?: unknown;
  ayah?: unknown;
  text?: unknown;
};

const ARABIC_VERSE_NUMBER = /[\s\u00a0\u0660-\u0669]+$/u;
let corpusPromise: Promise<QuranCorpus> | null = null;

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function attributesFor(tag: string) {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([a-z]+)="([^"]*)"/giu)) {
    attributes.set(match[1], decodeXml(match[2]));
  }
  return attributes;
}

export function parseQuranMetadataXml(xml: string): QuranSurah[] {
  const surahs = [...xml.matchAll(/<sura\s+([^>]+)\/>/giu)].map((match) => {
    const attributes = attributesFor(match[1]);
    const number = Number(attributes.get("index"));
    const ayahCount = Number(attributes.get("ayas"));
    const revelationType = attributes.get("type");
    if (!Number.isInteger(number) || !Number.isInteger(ayahCount) || (revelationType !== "Meccan" && revelationType !== "Medinan")) {
      throw new Error("The bundled Quran Surah metadata is invalid.");
    }
    return {
      number,
      ayahCount,
      arabicName: attributes.get("name") ?? "",
      transliteratedName: attributes.get("tname") ?? "",
      translatedName: attributes.get("ename") ?? "",
      revelationType,
    } satisfies QuranSurah;
  });
  if (surahs.length !== 114) throw new Error(`Expected 114 Surahs, but found ${surahs.length}.`);
  return surahs;
}

function stripTrailingVerseNumber(text: string) {
  return text.replace(ARABIC_VERSE_NUMBER, "").trimEnd();
}

export function parseQpcHafs(raw: unknown): Map<number, QuranAyah[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The bundled Quran text is not a verse-keyed object.");
  }
  const ayahsBySurah = new Map<number, QuranAyah[]>();
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as QpcHafsRow;
    const surahNumber = row.surah;
    const ayahNumber = row.ayah;
    const verseKey = row.verse_key;
    const text = row.text;
    if (
      typeof surahNumber !== "number" || !Number.isInteger(surahNumber) ||
      typeof ayahNumber !== "number" || !Number.isInteger(ayahNumber) ||
      typeof verseKey !== "string" || verseKey !== key || verseKey !== `${surahNumber}:${ayahNumber}` ||
      typeof text !== "string" || !text.trim()
    ) {
      throw new Error(`The bundled Quran text contains an invalid row at ${key}.`);
    }
    const ayah: QuranAyah = {
      verseKey,
      surahNumber,
      ayahNumber,
      arabicText: stripTrailingVerseNumber(text),
    };
    ayahsBySurah.set(surahNumber, [...(ayahsBySurah.get(surahNumber) ?? []), ayah]);
  }
  ayahsBySurah.forEach((ayahs) => ayahs.sort((first, second) => first.ayahNumber - second.ayahNumber));
  return ayahsBySurah;
}

export function validateQuranCorpus(surahs: QuranSurah[], ayahsBySurah: Map<number, QuranAyah[]>) {
  let totalAyahs = 0;
  for (const surah of surahs) {
    const ayahs = ayahsBySurah.get(surah.number) ?? [];
    if (ayahs.length !== surah.ayahCount) {
      throw new Error(`${surah.transliteratedName} should contain ${surah.ayahCount} ayahs, but found ${ayahs.length}.`);
    }
    ayahs.forEach((ayah, index) => {
      if (ayah.ayahNumber !== index + 1 || ayah.verseKey !== `${surah.number}:${index + 1}`) {
        throw new Error(`${surah.transliteratedName} contains a non-canonical ayah sequence.`);
      }
    });
    totalAyahs += ayahs.length;
  }
  if (totalAyahs !== 6236) throw new Error(`Expected 6,236 ayahs, but found ${totalAyahs}.`);
}

function publicAsset(path: string) {
  return `${import.meta.env.BASE_URL}${path}`;
}

export function loadQuranCorpus() {
  corpusPromise ??= Promise.all([
    fetch(publicAsset("quran/quran-data.xml")),
    fetch(publicAsset("quran/qpc_hafs.json")),
  ]).then(async ([metadataResponse, textResponse]) => {
    if (!metadataResponse.ok || !textResponse.ok) {
      throw new Error("MyVault could not load the bundled Quran reader files.");
    }
    const [metadataXml, qpcHafs] = await Promise.all([
      metadataResponse.text(),
      textResponse.json() as Promise<unknown>,
    ]);
    const surahs = parseQuranMetadataXml(metadataXml);
    const ayahsBySurah = parseQpcHafs(qpcHafs);
    validateQuranCorpus(surahs, ayahsBySurah);
    return { surahs, ayahsBySurah };
  }).catch((error) => {
    corpusPromise = null;
    throw error;
  });
  return corpusPromise;
}

export function safeQuranRoute(surahs: QuranSurah[], surahValue: string, ayahValue: string) {
  const requestedSurah = Number(surahValue);
  const requestedAyah = Number(ayahValue);
  const surah = surahs.find((candidate) => candidate.number === requestedSurah) ?? null;
  if (!surah || !Number.isInteger(requestedAyah) || requestedAyah < 1 || requestedAyah > surah.ayahCount) {
    return null;
  }
  return { surah, ayahNumber: requestedAyah };
}
