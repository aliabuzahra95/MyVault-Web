import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { INITIAL_QURAN_AUDIO_STATE, quranAudioTransition } from "../src/hooks/useQuranAudioPlayer";
import {
  audioPageForAyah,
  nextAudioAyah,
  parseVerseAudioPage,
  resolveQuranAudioUrl,
  selectSupportedReciters,
  verseAudioRequestUrl,
} from "../src/lib/quran/quranAudioData";
import { clearActiveGoogleAccount, setActiveGoogleAccount } from "../src/lib/sync/accountContext";
import { parseQuranReaderPreferences, readLocalQuranReaderPreferences, saveQuranReaderPreferences } from "../src/lib/quran/quranReaderPreferences";

const catalog = selectSupportedReciters({ recitations: [
  { id: 2, reciter_name: "Abdul Baset", style: "Murattal" },
  { id: 1, reciter_name: "Abdul Baset", style: "Mujawwad" },
  { id: 3, reciter_name: "Abdur-Rahman as-Sudais", style: null },
  { id: 7, reciter_name: "Mishary Rashid Alafasy", style: null },
] });
assert.deepEqual(catalog.slice(0, 4), [
  { id: 1, name: "Abdul Basit (Mujawwad)" },
  { id: 2, name: "Abdul Basit (Murattal)" },
  { id: 3, name: "Abdur-Rahman as-Sudais" },
  { id: 7, name: "Mishary al-Afasy" },
]);

assert.equal(
  verseAudioRequestUrl(7, 2, 6),
  "https://quran-proxy.aliabuhassan1995-054.workers.dev/proxy/content/api/v4/verses/by_chapter/2?language=en&audio=7&fields=verse_key&per_page=50&page=6",
);
assert.equal(resolveQuranAudioUrl("wbw/002_255_001.mp3"), "https://verses.quran.com/wbw/002_255_001.mp3");
assert.equal(resolveQuranAudioUrl("http://audio.example/2.mp3"), "https://audio.example/2.mp3");
const page = parseVerseAudioPage({
  verses: [
    { verse_key: "2:255", audio: { url: "verses/AbdulBaset/Mujawwad/mp3/002255.mp3" } },
    { verse_key: "2:256", audio: null },
  ],
  pagination: { next_page: 6 },
});
assert.equal(page.urls.get("2:255"), "https://verses.quran.com/verses/AbdulBaset/Mujawwad/mp3/002255.mp3");
assert.equal(page.urls.has("2:256"), false);
assert.equal(page.nextPage, 6);
assert.equal(audioPageForAyah(1), 1);
assert.equal(audioPageForAyah(255), 6);
assert.equal(nextAudioAyah(255, 286, 1), 256);
assert.equal(nextAudioAyah(1, 286, -1), null);
assert.equal(nextAudioAyah(286, 286, 1), null);

const reciter = { id: 7, name: "Mishary al-Afasy" };
const loading = quranAudioTransition(INITIAL_QURAN_AUDIO_STATE, { type: "load", ayahNumber: 255, reciter });
assert.equal(loading.status, "loading");
const playing = quranAudioTransition(loading, { type: "play" });
assert.equal(playing.status, "playing");
assert.equal(quranAudioTransition(playing, { type: "pause" }).status, "paused");
assert.equal(quranAudioTransition(playing, { type: "error", message: "offline" }).error, "offline");
assert.equal(quranAudioTransition(playing, { type: "end" }).status, "ended");
assert.deepEqual(quranAudioTransition(playing, { type: "stop" }), INITIAL_QURAN_AUDIO_STATE);

const restored = parseQuranReaderPreferences({ quranAudioReciterId: 7 }, false);
assert.equal(restored?.audioReciterId, 7);
const values = new Map<string, string>();
globalThis.localStorage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, value); },
};
setActiveGoogleAccount("audio-account-one");
saveQuranReaderPreferences({ ...restored!, audioReciterId: 7 });
setActiveGoogleAccount("audio-account-two");
saveQuranReaderPreferences({ ...restored!, audioReciterId: 3 });
assert.equal(readLocalQuranReaderPreferences("audio-account-one")?.audioReciterId, 7);
assert.equal(readLocalQuranReaderPreferences("audio-account-two")?.audioReciterId, 3);
clearActiveGoogleAccount();
delete (globalThis as { localStorage?: Storage }).localStorage;

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const [readerSource, playerSource] = await Promise.all([
  readFile(`${appRoot}src/components/quran/quran-reader.tsx`, "utf8"),
  readFile(`${appRoot}src/hooks/useQuranAudioPlayer.ts`, "utf8"),
]);
assert.match(readerSource, /data-testid="quran-play-ayah"/, "Each selected ayah must expose a play action");
assert.match(readerSource, /data-testid="quran-audio-player"/, "Active audio must expose the compact player");
assert.match(readerSource, /audioStatus=.*audioPlayer\.state/, "Playing state must remain distinct per ayah");
assert.match(playerSource, /new Audio\(\)/, "Playback must use the browser audio controller");
assert.match(playerSource, /nextAudioAyah\(current, ayahCountRef\.current, 1\)/, "Completion must progress continuously within the Surah");
assert.match(playerSource, /removeEventListener\("ended"/, "Playback listeners must be cleaned up");
assert.match(playerSource, /requestRef\.current\?\.abort\(\)/, "Stale audio metadata requests must be aborted");

console.log("Quran Phase 3 verified: Android reciter matching, URL generation, persisted account-specific reciters, playback transitions, bounded progression, errors, and controller cleanup.");
