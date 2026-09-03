import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { clearActiveGoogleAccount, setActiveGoogleAccount } from "../src/lib/sync/accountContext";
import { parseQuranMetadataXml, safeQuranRoute } from "../src/lib/quran/quranData";
import {
  parseQuranReaderPreferences,
  quranReaderPreferencesStorageKey,
  readLocalQuranReaderPreferences,
  saveQuranReaderPreferences,
} from "../src/lib/quran/quranReaderPreferences";
import {
  quranCopyPayload,
  quranReference,
  toggleExpandedFootnote,
  toggleSelectedAyah,
  translationIsVisible,
} from "../src/lib/quran/quranSelection";
import {
  parseBundledMaududi,
  parseMaududiRemoteEntry,
  parseMukhtasarTafsir,
  parseSahihInternational,
  selectEstablishedTafsirSources,
  selectRemoteTafsirHtml,
} from "../src/lib/quran/quranSupplementalData";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const [metadataBytes, sahihBytes, maududiBytes, tafsirBytes, indexSourceBytes, readerSourceBytes] = await Promise.all([
  readFile(`${appRoot}public/quran/quran-data.xml`),
  readFile(`${appRoot}public/quran/Sahih_international.json`),
  readFile(`${appRoot}public/quran/Maududi_en_tanzil.txt`),
  readFile(`${appRoot}public/quran/abridged_tafsir.json`),
  readFile(`${appRoot}src/pages/quran.tsx`),
  readFile(`${appRoot}src/components/quran/quran-reader.tsx`),
]);
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
assert.equal(sha256(sahihBytes), "77f30d1b920695be640858383c786f0b4b77ff457c0693b8be91eb65b485861c");
assert.equal(sha256(maududiBytes), "12ec516ae49c7607aa4f8fa63df33db01e7e1f54f80254102e41c7d1729923b0");
assert.equal(sha256(tafsirBytes), "8f30054ea8b5f1e19b78fbe2b30cca5998da31583a9902a9b7301cd5e81ea766");

const sahih = parseSahihInternational(JSON.parse(sahihBytes.toString("utf8")) as unknown);
const maududi = parseBundledMaududi(maududiBytes.toString("utf8"));
const mukhtasar = parseMukhtasarTafsir(JSON.parse(tafsirBytes.toString("utf8")) as unknown);
assert.equal(sahih.size, 6_236);
assert.equal(maududi.size, 6_236);
assert.equal(mukhtasar.size, 6_216);
assert.match(sahih.get("2:255")?.text ?? "", /Ever-Living/);
assert.match(maududi.get("2:255")?.text ?? "", /Everlasting/);
assert.match(mukhtasar.get("2:255") ?? "", /deserves to be worshipped/);

const footnoted = parseMaududiRemoteEntry(
  'One.<sup foot_note="177285">1</sup> Two.<sup foot_note="177286">2</sup>',
  { "177285": "First note", "177286": "Second note" },
);
assert.equal(footnoted.text, "One.1 Two.2");
assert.deepEqual(footnoted.footnotes.map(({ id, label, text }) => ({ id, label, text })), [
  { id: "177285", label: "1", text: "First note" },
  { id: "177286", label: "2", text: "Second note" },
]);
assert.equal(toggleExpandedFootnote(null, "177285"), "177285");
assert.equal(toggleExpandedFootnote("177285", "177285"), null);
assert.equal(toggleExpandedFootnote("177285", "177286"), "177286");

const sources = selectEstablishedTafsirSources({ tafsirs: [
  { id: 14, name: "Tafsir Ibn Kathir", language_name: "arabic" },
  { id: 169, name: "Ibn Kathir (Abridged)", language_name: "english" },
  { id: 15, name: "Tafsir al-Tabari", language_name: "arabic" },
  { id: 90, name: "Al-Qurtubi", language_name: "arabic" },
] });
assert.deepEqual(sources.map(({ id, name, direction }) => ({ id, name, direction })), [
  { id: 169, name: "Ibn Kathir", direction: "ltr" },
  { id: 15, name: "Al-Tabari", direction: "rtl" },
  { id: 90, name: "Al-Qurtubi", direction: "rtl" },
  { id: -1, name: "Mukhtasar", direction: "ltr" },
]);
assert.equal(selectRemoteTafsirHtml({ verse: { tafsirs: [
  { resource_id: 169, text: "" },
  { resource_id: 169, text: "Exact 2:255 commentary" },
  { resource_id: 15, text: "Wrong source" },
] } }, 169), "Exact 2:255 commentary");

assert.equal(toggleSelectedAyah(null, 255), 255);
assert.equal(toggleSelectedAyah(255, 255), null);
assert.equal(toggleSelectedAyah(255, 256), 256);
const entry = sahih.get("2:255") ?? null;
assert.equal(translationIsVisible(true, entry), true);
assert.equal(translationIsVisible(false, entry), false);
const reference = quranReference("Al-Baqara", 2, 255);
assert.equal(reference, "Al-Baqara 2:255");
assert.equal(quranCopyPayload("arabic", { arabicText: "اللَّهُ", translation: entry, reference }), "اللَّهُ");
assert.equal(quranCopyPayload("reference", { arabicText: "اللَّهُ", translation: entry, reference }), reference);
assert.equal(quranCopyPayload("translation", { arabicText: "اللَّهُ", translation: entry, reference }), entry?.text);

const restored = parseQuranReaderPreferences({
  quranArabicFontPercent: 130,
  quranTranslationEnabled: false,
  quranTranslationSource: "maududi",
  quranTranslationFontPercent: 125,
  quranTafsirSourceId: 169,
}, false);
assert.deepEqual(restored, { schemaVersion: 1, arabicFontPercent: 130, translationEnabled: false, translationSource: "maududi", translationFontPercent: 125, tafsirSourceId: 169 });

const values = new Map<string, string>();
globalThis.localStorage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, value); },
};
setActiveGoogleAccount("account-one");
saveQuranReaderPreferences({ schemaVersion: 1, arabicFontPercent: 120, translationEnabled: false, translationSource: "maududi", translationFontPercent: 110, tafsirSourceId: 169 });
setActiveGoogleAccount("account-two");
saveQuranReaderPreferences({ schemaVersion: 1, arabicFontPercent: 90, translationEnabled: true, translationSource: "sahih_international", translationFontPercent: 90, tafsirSourceId: -1 });
assert.notEqual(quranReaderPreferencesStorageKey("account-one"), quranReaderPreferencesStorageKey("account-two"));
assert.equal(readLocalQuranReaderPreferences("account-one")?.translationSource, "maududi");
assert.equal(readLocalQuranReaderPreferences("account-one")?.arabicFontPercent, 120);
assert.equal(readLocalQuranReaderPreferences("account-one")?.tafsirSourceId, 169);
assert.equal(readLocalQuranReaderPreferences("account-two")?.translationSource, "sahih_international");
clearActiveGoogleAccount();
delete (globalThis as { localStorage?: Storage }).localStorage;

const surahs = parseQuranMetadataXml(metadataBytes.toString("utf8"));
const beforeTafsir = safeQuranRoute(surahs, "2", "255");
assert.equal(beforeTafsir?.ayahNumber, 255);
assert.deepEqual(safeQuranRoute(surahs, "2", "255"), beforeTafsir);

const indexSource = indexSourceBytes.toString("utf8");
const readerSource = readerSourceBytes.toString("utf8");
assert.match(indexSource, /md:grid-cols-2/, "Surah index must become two compact columns on wider screens");
assert.match(indexSource, /border-b border-border\/65/, "Surah entries must use compact divided rows");
assert.doesNotMatch(indexSource, /rounded-2xl.*quran-surah/s, "Surahs must not return to giant cards");
assert.match(readerSource, /arabicFontPercent/, "Arabic font size preference must reach the reading surface");
assert.match(readerSource, /selected && .*inset_2px_0_0/, "Selected ayahs must use a restrained accent edge");
assert.match(readerSource, /current \? .*Last read/s, "Last-read treatment must remain separate from selection");
assert.match(readerSource, /isMobile \? "bottom" : "right"/, "Display and Tafsir panels must adapt to mobile and desktop");

console.log("Quran Phase 2.5 verified: exact Android assets and mappings, compact responsive rows, Arabic sizing, distinct selection/last-read states, account isolation, and preserved deep links.");
