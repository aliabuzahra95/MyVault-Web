# MyVault Web Quran Reader — Architecture Audit and Phase 1 Contract

Date: 2026-09-03

## Recovery point

- Web repository: `https://github.com/aliabuzahra95/MyVault-Web.git`
- Web branch at start: `main`
- Web starting commit: `511c057320800a83a5cef3f47a2f02f6134e414c`
- Recovery tag: `recovery-web-quran-phase1-20260903`
- The recovery tag is pushed to `origin` and resolves to the starting commit.

## Audited architecture

The Web application is a pnpm/Vite/React workspace. The browser app lives in
`artifacts/myvault-web`; routing uses Wouter; shared restored Android metadata is
held account-by-account in IndexedDB; and verified Google Drive restore and
write-back pass through the existing safe-sync pipeline.

The Qur'an route existed only as a placeholder before this checkpoint. No Qur'an
data model, reader, or reader-state mutation was present in the Web application.
The navigation tree already reserved `/quran`, and Vercel already rewrites nested
browser paths to the single-page application, so exact deep links can use normal
paths without changing hosting behavior.

## Android source of truth

Android reference repository:
`/Users/aliah/Desktop/Current Projects/MyVault Complete Before Tutor`

Audited Android commit: `1e513a03089bf358c6068f453cf064b86cd6e8a6` on
`frozen-design-master-port`.

The current Android reader is resume-first and Surah/ayah based. Its stable
identity is `surah:ayah`. The canonical Arabic display text comes from
`qpc_hafs.json`; Surah metadata is also bundled in `quran-data.xml`; and the
reader uses `uthmani_hafs.ttf`. Android strips the trailing ornamental ayah
number from each text row and renders the number separately. Phase 1 mirrors
that behavior.

Android's backup-compatible reading keys already are:

- `quranLastReadSurah`
- `quranLastReadAyah`
- `quranRecentLocations`, whose rows contain `surahNumber`, `ayahNumber`, and
  `lastReadAt`

The Web restore layer already preserves `settings.json` and all unknown/additive
settings. Phase 1 reads those Android keys as the initial Web position when they
are present. Web reading progress is stored in a versioned, account-scoped local
record so reloading the browser returns to the exact ayah. This checkpoint does
not add a new backup file, modify Android, or change Drive restore/write-back.

## Phase 1 implementation boundary

Included:

- searchable list of all 114 Surahs;
- full continuous Surah reader using all 6,236 bundled Uthmani Hafs ayahs;
- exact routes in the form `/quran/:surah/:ayah`;
- automatic URL updates as the reading position changes;
- direct ayah jump and previous/next Surah navigation;
- account-scoped persisted last-read position, seeded from restored Android
  settings;
- responsive MyVault light/dark styling and the same bundled Qur'an font.

Explicitly deferred to later checkpoints:

- translations and translation footnotes;
- tafsir;
- audio, reciters, downloads, and playback controls;
- selected-ayah toolbar/actions;
- reflections and bookmarks;
- tajweed spans and word-level interactions;
- global search integration;
- Drive write-back of Web-originated Qur'an preference changes;
- all Memorise and AI Listen features.

## Compatibility rules for later phases

1. Keep `surah:ayah` as the canonical verse identity.
2. Reuse the existing Android assets and preference/settings keys where they
   cover the feature; do not create a competing Qur'an schema.
3. Keep downloaded recitation audio device-local unless the Android contract is
   deliberately changed in a separately reviewed migration.
4. Store reflections as the existing backed-up Study notes with structured
   Qur'an source metadata.
5. Preserve every unknown Android backup field through Web restore and
   write-back.
6. Keep Memorise outside the Web Qur'an reader scope requested here.
