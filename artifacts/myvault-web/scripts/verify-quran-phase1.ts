import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  parseQpcHafs,
  parseQuranMetadataXml,
  safeQuranRoute,
  validateQuranCorpus,
} from "../src/lib/quran/quranData";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const metadataPath = `${appRoot}public/quran/quran-data.xml`;
const textPath = `${appRoot}public/quran/qpc_hafs.json`;
const fontPath = `${appRoot}public/fonts/uthmani_hafs.ttf`;

const [metadataBytes, textBytes, fontBytes] = await Promise.all([
  readFile(metadataPath),
  readFile(textPath),
  readFile(fontPath),
]);

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

assert.equal(sha256(metadataBytes), "8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a");
assert.equal(sha256(textBytes), "93864197a949dac54f324875f41348875455bb138b7abdfde43daefe87230403");
assert.equal(sha256(fontBytes), "aa68bffce289b4c0ebac68e90502eb69e42356abcd1603cb2b8e99c2c723f145");

const metadataXml = metadataBytes.toString("utf8");
assert.match(metadataXml, /copyright="\(C\) 2008-2009 Tanzil\.info" license="cc-by"/);
const surahs = parseQuranMetadataXml(metadataXml);
const ayahsBySurah = parseQpcHafs(JSON.parse(textBytes.toString("utf8")) as unknown);
validateQuranCorpus(surahs, ayahsBySurah);

assert.equal(surahs.length, 114);
assert.equal(ayahsBySurah.get(1)?.[0]?.verseKey, "1:1");
assert.equal(ayahsBySurah.get(2)?.length, 286);
assert.equal(ayahsBySurah.get(114)?.at(-1)?.verseKey, "114:6");
assert.doesNotMatch(ayahsBySurah.get(1)?.[0]?.arabicText ?? "", /[\u0660-\u0669]$/u);
assert.equal(safeQuranRoute(surahs, "2", "255")?.ayahNumber, 255);
assert.equal(safeQuranRoute(surahs, "2", "287"), null);
assert.equal(safeQuranRoute(surahs, "115", "1"), null);

console.log("Quran Phase 1 contract verified: 114 Surahs, 6,236 canonical ayahs, exact Android asset hashes, and bounded deep-link routes.");
