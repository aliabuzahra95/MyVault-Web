# MyVault Web Quran Phase 2 Audit

Date: 2026-09-03

## Checkpoint and scope

- Web branch: `main`
- Accepted Phase 1 commit: `7fa6c18e0116fa75e0f813b590e86a0a7258e517`
- Phase 2 start tag: `recovery-web-quran-phase2-start-20260903`
- Android was inspected as the product/data reference and was not modified.
- Phase 2 is limited to translation, ayah selection/copy actions, and Tafsir. Audio, Memorise, reflections, bookmarks, tajweed, Global Search, progress write-back, and backup-format changes remain excluded.

## Android translation contract

Android defines one active English translation at a time in `QuranTranslationSource`:

| Stored ID | Product name | Android asset | Mapping | Availability |
| --- | --- | --- | --- | --- |
| `sahih_international` | Sahih International | `Sahih_international.json` | Object keyed by `surah:ayah`, text field `t` | Complete offline, 6,236 ayahs |
| `maududi` | Tafheem-ul-Quran (Sayyid Abul Ala Maududi) | `Maududi_en_tanzil.txt` | `surah|ayah|translation`, preserving pipes after the second delimiter | Complete offline, 6,236 ayahs |

The Maududi asset identifies itself as English, ID `en.maududi`, last updated 2011-05-10, sourced from Tanzil.net. Android optionally enriches the offline Maududi text with Quran Foundation resource `95`, including numbered explanatory footnotes. Web uses the same bundled bytes and the same optional enrichment route. A failed enrichment never prevents the offline translation from appearing.

Android defaults to Sahih International, permits one source at a time, and stores `quranTranslationEnabled`, `quranTranslationSource`, and `quranTranslationFontPercent` in settings backup schema version 1. Web reads those restored values when no account-local browser preference exists. Later Web changes remain local to that account/browser and do not alter Drive or the backup schema.

## Android Tafsir contract

| Source | ID behavior | Language | Storage/loading |
| --- | --- | --- | --- |
| Mukhtasar | `-1` | English | `abridged_tafsir.json`, with all 6,236 `surah:ayah` keys and 6,216 non-empty offline passages |
| Ibn Kathir | Quran Foundation resource selected by name, preferring English (currently `169`) | English | Loaded per selected ayah through the existing MyVault Cloudflare proxy |
| Al-Tabari | Quran Foundation resource selected by name, preferring Arabic (currently `15`) | Arabic | Loaded per selected ayah through the existing proxy |
| Al-Qurtubi | Quran Foundation resource selected by name, preferring Arabic (currently `90`) | Arabic | Loaded per selected ayah through the existing proxy |

Android discovers remote IDs from the Quran Foundation catalog instead of treating the current numeric IDs as permanent. Web reproduces that behavior, filters only the same three established sources, and falls back safely to offline Mukhtasar when the catalog is unavailable. Remote Tafsir is fetched only after the user opens the Tafsir panel and is cached per `verseKey|sourceId` for the current page session.

The Android setting `quranTafsirSourceId` is backed up. Web consumes it where the source remains available and otherwise uses Mukhtasar. Arabic sources are rendered RTL; English sources are rendered LTR.

## Phase 2 Web state and compatibility

- Reader preferences use an account-scoped localStorage record separate from Phase 1's account-scoped last-read record.
- Resolution order is account-local Web preference, then restored Android `settings.json`, then Android-compatible defaults.
- No existing restore, sync, backup, or Android file was changed.
- The exact `/quran/{surah}/{ayah}` path continues to represent reading position. Selection and Tafsir are transient UI state and do not rewrite the deep link.
- Translation assets load only when translation is enabled. Tafsir corpus/content loads only when requested.
- Ayah rows are memoized and retain `content-visibility: auto` so selection changes do not require every Al-Baqara row to render again.
