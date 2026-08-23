import type { Folder, Note, NoteDetail, Tag, Attachment, SearchResults, HomeSnapshot, KnowledgeTag, KnowledgeTagLink, NoteVersion } from "@workspace/api-client-react";

const now = Date.now();
const d = (days: number) => now - days * 86400000;

// ─── FOLDERS ────────────────────────────────────────────────────────────────

export const personalFolders: Folder[] = [
  { id: "f1", parentId: null, title: "Projects", description: "Active work projects and ideas", mode: "study", workspace: "personal", orderIndex: 0, noteCount: 8, createdAt: d(120), updatedAt: d(2) },
  { id: "f1a", parentId: "f1", title: "Web Dev", description: "Frontend and full-stack projects", mode: "study", workspace: "personal", orderIndex: 0, noteCount: 3, createdAt: d(100), updatedAt: d(3) },
  { id: "f1b", parentId: "f1", title: "Mobile", description: "Android and iOS projects", mode: "study", workspace: "personal", orderIndex: 1, noteCount: 2, createdAt: d(90), updatedAt: d(5) },
  { id: "f2", parentId: null, title: "Journal", description: "Daily reflections and personal writing", mode: "study", workspace: "personal", orderIndex: 1, noteCount: 7, createdAt: d(200), updatedAt: d(1) },
  { id: "f2a", parentId: "f2", title: "2024", description: "Year 2024 entries", mode: "study", workspace: "personal", orderIndex: 0, noteCount: 4, createdAt: d(200), updatedAt: d(40) },
  { id: "f2b", parentId: "f2", title: "2025", description: "Year 2025 entries", mode: "study", workspace: "personal", orderIndex: 1, noteCount: 3, createdAt: d(30), updatedAt: d(1) },
  { id: "f3", parentId: null, title: "Research", description: "Reading notes and research synthesis", mode: "study", workspace: "personal", orderIndex: 2, noteCount: 6, createdAt: d(150), updatedAt: d(4) },
  { id: "f3a", parentId: "f3", title: "AI & ML", description: "Artificial intelligence notes", mode: "study", workspace: "personal", orderIndex: 0, noteCount: 4, createdAt: d(140), updatedAt: d(4) },
  { id: "f4", parentId: null, title: "Library", description: "PDFs and reference documents", mode: "library", workspace: "personal", orderIndex: 3, noteCount: 0, createdAt: d(180), updatedAt: d(10) },
];

export const islamicFolders: Folder[] = [
  { id: "if1", parentId: null, title: "Quran Notes", description: "Reflections and tafsir notes on Quranic verses", mode: "study", workspace: "islamic_corpus", orderIndex: 0, noteCount: 4, createdAt: d(90), updatedAt: d(2) },
  { id: "if1a", parentId: "if1", title: "Surah Al-Baqarah", description: "Notes on the second surah", mode: "study", workspace: "islamic_corpus", orderIndex: 0, noteCount: 2, createdAt: d(60), updatedAt: d(7) },
  { id: "if2", parentId: null, title: "Hadith Study", description: "Authentic hadith notes and commentary", mode: "study", workspace: "islamic_corpus", orderIndex: 1, noteCount: 4, createdAt: d(75), updatedAt: d(3) },
  { id: "if3", parentId: null, title: "Fiqh Notes", description: "Islamic jurisprudence notes", mode: "study", workspace: "islamic_corpus", orderIndex: 2, noteCount: 2, createdAt: d(50), updatedAt: d(14) },
];

export const islamicLibraryFolders: Folder[] = [
  { id: "il1", parentId: null, title: "Quran and Tafsir", description: "Tafsir, translations, and Quran reference works", mode: "library", workspace: "islamic_corpus", orderIndex: 0, noteCount: 0, createdAt: d(100), updatedAt: d(5) },
  { id: "il1a", parentId: "il1", title: "Tafsir", description: "Classical and contemporary commentary", mode: "library", workspace: "islamic_corpus", orderIndex: 0, noteCount: 0, createdAt: d(90), updatedAt: d(7) },
  { id: "il2", parentId: null, title: "Hadith", description: "Collections and commentary", mode: "library", workspace: "islamic_corpus", orderIndex: 1, noteCount: 0, createdAt: d(80), updatedAt: d(12) },
  { id: "il3", parentId: null, title: "Fiqh", description: "Jurisprudence and legal principles", mode: "library", workspace: "islamic_corpus", orderIndex: 2, noteCount: 0, createdAt: d(60), updatedAt: d(20) },
];

export const allFolders = [...personalFolders, ...islamicFolders, ...islamicLibraryFolders];

// ─── NOTES ───────────────────────────────────────────────────────────────────

export const personalNotes: Note[] = [
  { id: "n1", folderId: "f1a", parentNoteId: null, title: "MyVault Web Architecture", bodyPreview: "Planning the companion web app for MyVault. Key decisions: React + Vite, TanStack Query for data fetching, Wouter for routing...", wordCount: 420, characterCount: 2580, isPinned: true, isFolderPinned: false, orderIndex: 0, tagNames: ["work", "ideas"], createdAt: d(15), updatedAt: d(1) },
  { id: "n2", folderId: "f1a", parentNoteId: null, title: "OpenAPI Design Patterns", bodyPreview: "Best practices for designing REST APIs that scale. Contract-first development with Orval codegen ensures type safety across the stack...", wordCount: 310, characterCount: 1890, isPinned: false, isFolderPinned: false, orderIndex: 1, tagNames: ["work"], createdAt: d(12), updatedAt: d(3) },
  { id: "n3", folderId: "f1a", parentNoteId: null, title: "Tailwind v4 Migration Notes", bodyPreview: "Key changes from v3: CSS-first configuration, @theme directive, removal of JIT mode (it's always on), new @variant syntax...", wordCount: 280, characterCount: 1720, isPinned: false, isFolderPinned: false, orderIndex: 2, tagNames: ["work"], createdAt: d(8), updatedAt: d(2) },
  { id: "n4", folderId: "f1b", parentNoteId: null, title: "Android Compose Best Practices", bodyPreview: "State hoisting, remember vs rememberSaveable, LaunchedEffect for side effects. The key insight: keep your composables stateless when possible...", wordCount: 350, characterCount: 2140, isPinned: true, isFolderPinned: false, orderIndex: 0, tagNames: ["work", "ideas"], createdAt: d(20), updatedAt: d(5) },
  { id: "n5", folderId: "f1b", parentNoteId: null, title: "Room Database Schema v21", bodyPreview: "Migration strategy for the vault's Room DB. Added knowledge tag linking table, updated note block schema to support rich content types...", wordCount: 190, characterCount: 1150, isPinned: false, isFolderPinned: false, orderIndex: 1, tagNames: ["work"], createdAt: d(18), updatedAt: d(6) },
  { id: "n6", folderId: "f2b", parentNoteId: null, title: "Morning Reflection - July", bodyPreview: "Started the day with gratitude. The small things matter most: a quiet morning, a good cup of coffee, clarity of thought before the noise begins...", wordCount: 240, characterCount: 1460, isPinned: false, isFolderPinned: false, orderIndex: 0, tagNames: ["personal"], createdAt: d(5), updatedAt: d(5) },
  { id: "n7", folderId: "f2b", parentNoteId: null, title: "On Building Habits", bodyPreview: "The gap between who we are and who we want to be is bridged one small action at a time. Starting with 5-minute habits that compound over months...", wordCount: 380, characterCount: 2300, isPinned: false, isFolderPinned: false, orderIndex: 1, tagNames: ["personal", "goals"], createdAt: d(8), updatedAt: d(7) },
  { id: "n8", folderId: "f2a", parentNoteId: null, title: "Year in Review 2024", bodyPreview: "What went well: shipped the MyVault Android app, learned Kotlin Compose deeply, read 18 books. What to improve: consistency in journaling, more exercise...", wordCount: 560, characterCount: 3380, isPinned: false, isFolderPinned: false, orderIndex: 0, tagNames: ["personal", "goals"], createdAt: d(180), updatedAt: d(180) },
  { id: "n9", folderId: "f3a", parentNoteId: null, title: "Attention Mechanisms Explained", bodyPreview: "The transformer architecture's key insight: query, key, value matrices allow each token to attend to all others. Scaled dot-product attention formula: softmax(QK^T / √d_k)V...", wordCount: 490, characterCount: 3020, isPinned: true, isFolderPinned: false, orderIndex: 0, tagNames: ["reading", "ideas"], createdAt: d(25), updatedAt: d(10) },
  { id: "n10", folderId: "f3a", parentNoteId: null, title: "LLM Inference Optimization", bodyPreview: "Key techniques: KV cache reuse, speculative decoding, flash attention, grouped query attention. Practical impact: 3x throughput improvement with proper batching...", wordCount: 320, characterCount: 1960, isPinned: false, isFolderPinned: false, orderIndex: 1, tagNames: ["reading"], createdAt: d(18), updatedAt: d(12) },
];

export const islamicNotes: Note[] = [
  { id: "in1", folderId: "if1", parentNoteId: null, title: "Tawakkul — Complete Reliance on Allah", bodyPreview: "Tawakkul is not passivity but active trust after having taken the means. The example of the bird that leaves in the morning with an empty stomach and returns full...", wordCount: 410, characterCount: 2510, isPinned: true, isFolderPinned: false, orderIndex: 0, tagNames: [], createdAt: d(30), updatedAt: d(2) },
  { id: "in2", folderId: "if1a", parentNoteId: null, title: "Al-Baqarah 2:286 — Allah Does Not Burden", bodyPreview: "لَا يُكَلِّفُ ٱللَّهُ نَفۡسًا إِلَّا وُسۡعَهَا — Allah does not burden a soul beyond that it can bear. This ayah is a mercy and a reminder...", wordCount: 320, characterCount: 1980, isPinned: false, isFolderPinned: false, orderIndex: 0, tagNames: [], createdAt: d(22), updatedAt: d(7) },
  { id: "in3", folderId: "if2", parentNoteId: null, title: "Hadith on Sabr — Patience in Difficulty", bodyPreview: "The Prophet ﷺ said: 'How wonderful is the affair of the believer, for his affairs are all good, and this applies to no one but the believer. If something good happens to him, he is thankful...'", wordCount: 380, characterCount: 2320, isPinned: false, isFolderPinned: false, orderIndex: 0, tagNames: [], createdAt: d(15), updatedAt: d(3) },
  { id: "in4", folderId: "if2", parentNoteId: null, title: "Forty Hadith An-Nawawi — Study Notes", bodyPreview: "Working through Imam Nawawi's collection. Hadith 1: Actions are by intentions. This is the foundation of all Islamic ethics — the niyyah precedes the deed...", wordCount: 640, characterCount: 3900, isPinned: true, isFolderPinned: false, orderIndex: 1, tagNames: [], createdAt: d(45), updatedAt: d(10) },
  { id: "in5", folderId: "if3", parentNoteId: null, title: "Principles of Usul al-Fiqh", bodyPreview: "The five major goals of Sharia (maqasid): preservation of religion, life, intellect, lineage, and wealth. Every ruling traces back to protecting one of these...", wordCount: 480, characterCount: 2940, isPinned: false, isFolderPinned: false, orderIndex: 0, tagNames: [], createdAt: d(50), updatedAt: d(14) },
  { id: "in6", folderId: "if1a", parentNoteId: null, title: "Ayat al-Kursi — The Throne Verse", bodyPreview: "ٱللَّهُ لَآ إِلَـٰهَ إِلَّا هُوَ ٱلۡحَىُّ ٱلۡقَيُّومُ — The greatest ayah in the Quran. Its protection and its depth of meaning about Allah's attributes...", wordCount: 290, characterCount: 1780, isPinned: false, isFolderPinned: false, orderIndex: 1, tagNames: [], createdAt: d(18), updatedAt: d(8) },
];

export const allNotes = [...personalNotes, ...islamicNotes];

// ─── NOTE DETAILS ─────────────────────────────────────────────────────────────

export const noteDetails: Record<string, NoteDetail> = {
  "n1": {
    ...personalNotes[0],
    richTextJson: null,
    blocks: [
      { id: "b1", noteId: "n1", type: "heading1", content: "MyVault Web Architecture", orderIndex: 0 },
      { id: "b2", noteId: "n1", type: "paragraph", content: "Planning the companion web app for MyVault. Key decisions: React + Vite, TanStack Query for data fetching, Wouter for routing.", orderIndex: 1 },
      { id: "b3", noteId: "n1", type: "heading2", content: "Technology Stack", orderIndex: 2 },
      { id: "b4", noteId: "n1", type: "bullet", content: "React 19 + Vite 6 — fast HMR and optimized builds", orderIndex: 3 },
      { id: "b5", noteId: "n1", type: "bullet", content: "TanStack Query — server state management with caching", orderIndex: 4 },
      { id: "b6", noteId: "n1", type: "bullet", content: "Orval codegen — typed API hooks from OpenAPI spec", orderIndex: 5 },
      { id: "b7", noteId: "n1", type: "bullet", content: "Wouter — lightweight client-side routing", orderIndex: 6 },
      { id: "b8", noteId: "n1", type: "heading2", content: "Key Design Principles", orderIndex: 7 },
      { id: "b9", noteId: "n1", type: "paragraph", content: "The web companion should mirror the Android app's data model exactly. This ensures that when we connect to the real backend, no architectural changes are needed.", orderIndex: 8 },
      { id: "b10", noteId: "n1", type: "quote", content: "Design for the API you want, not the one you have.", orderIndex: 9 },
      { id: "b11", noteId: "n1", type: "paragraph", content: "Mock data layer uses a fetch interceptor that returns realistic data for all /api/* endpoints. Swapping in real API calls is a one-line change.", orderIndex: 10 },
    ]
  },
  "in1": {
    ...islamicNotes[0],
    richTextJson: JSON.stringify({
      text: "Overview\n\nTawakkul is not passivity but active trust after having taken the means.\n\nPractical Application\n\n• Make dua before beginning any task\n• Take the appropriate means with full effort\n• Release attachment to the outcome — it belongs to Allah",
      styleMarks: [
        { start: 0, end: 8, style: "Heading" },
        { start: 10, end: 18, style: "Bold" },
        { start: 84, end: 105, style: "Heading2" },
      ],
      noteLinks: [],
    }),
    blocks: [
      { id: "ib1", noteId: "in1", type: "heading1", content: "Tawakkul — Complete Reliance on Allah", orderIndex: 0 },
      { id: "ib2", noteId: "in1", type: "paragraph", content: "Tawakkul is not passivity but active trust after having taken the means. The Prophet ﷺ famously said to the man who asked about tying his camel:", orderIndex: 1 },
      { id: "ib3", noteId: "in1", type: "quote", content: "\"Tie your camel, then put your trust in Allah.\" — Tirmidhi", orderIndex: 2 },
      { id: "ib4", noteId: "in1", type: "paragraph", content: "This hadith encapsulates the balance: take the means (tying the camel), then entrust the outcome to Allah. Tawakkul comes after action, not instead of it.", orderIndex: 3 },
      { id: "ib5", noteId: "in1", type: "heading2", content: "The Bird Analogy", orderIndex: 4 },
      { id: "ib6", noteId: "in1", type: "paragraph", content: "The Prophet ﷺ said: 'If you were to rely upon Allah with true reliance, He would provide for you just as He provides for the birds: they go out in the morning hungry and return in the evening full.' — Tirmidhi", orderIndex: 5 },
      { id: "ib7", noteId: "in1", type: "heading2", content: "Practical Application", orderIndex: 6 },
      { id: "ib8", noteId: "in1", type: "numbered", content: "Make dua before beginning any task", orderIndex: 7 },
      { id: "ib9", noteId: "in1", type: "numbered", content: "Take the appropriate means with full effort", orderIndex: 8 },
      { id: "ib10", noteId: "in1", type: "numbered", content: "Release attachment to the outcome — it belongs to Allah", orderIndex: 9 },
    ]
  }
};

// ─── NOTE VERSIONS ────────────────────────────────────────────────────────────

export const noteVersionsMap: Record<string, NoteVersion[]> = {
  "n1": [
    { id: "v1", noteId: "n1", title: "MyVault Web Architecture", bodyPlainText: "Initial planning notes...", wordCount: 120, characterCount: 720, createdAt: d(15) },
    { id: "v2", noteId: "n1", title: "MyVault Web Architecture", bodyPlainText: "Added technology stack section...", wordCount: 280, characterCount: 1680, createdAt: d(10) },
    { id: "v3", noteId: "n1", title: "MyVault Web Architecture", bodyPlainText: "Added key design principles...", wordCount: 420, characterCount: 2580, createdAt: d(1) },
  ],
};

// ─── TAGS ─────────────────────────────────────────────────────────────────────

export const tags: Tag[] = [
  { name: "work", noteCount: 5 },
  { name: "personal", noteCount: 4 },
  { name: "ideas", noteCount: 3 },
  { name: "reading", noteCount: 3 },
  { name: "goals", noteCount: 2 },
];

// ─── ATTACHMENTS ──────────────────────────────────────────────────────────────

export const attachments: Attachment[] = [
  { id: "a1", noteId: null, libraryFolderId: "il1a", name: "Quran Tafsir Ibn Kathir Vol.1.pdf", mimeType: "application/pdf", sizeBytes: 8900000, isPinned: true, readingProgressPercent: 15, createdAt: d(90), updatedAt: d(7) },
  { id: "a2", noteId: null, libraryFolderId: "il2", name: "Forty Hadith An-Nawawi Commentary.pdf", mimeType: "application/pdf", sizeBytes: 4200000, isPinned: true, readingProgressPercent: 42, createdAt: d(60), updatedAt: d(12) },
  { id: "a3", noteId: null, libraryFolderId: "il3", name: "Mukhtasar Al-Quduri Notes.pdf", mimeType: "application/pdf", sizeBytes: 3100000, isPinned: false, readingProgressPercent: 8, createdAt: d(45), updatedAt: d(20) },
  { id: "a4", noteId: "in2", libraryFolderId: null, name: "Surah Al-Baqarah Reflection Pack.pdf", mimeType: "application/pdf", sizeBytes: 892000, isPinned: false, readingProgressPercent: 100, createdAt: d(25), updatedAt: d(10) },
  { id: "a5", noteId: null, libraryFolderId: "il1", name: "Arabic Vocabulary Roots.pdf", mimeType: "application/pdf", sizeBytes: 1700000, isPinned: false, readingProgressPercent: 63, createdAt: d(30), updatedAt: d(5) },
];

// ─── KNOWLEDGE TAGS ───────────────────────────────────────────────────────────

export const knowledgeTags: KnowledgeTag[] = [
  { id: "kt1", name: "Tawakkul", linkCount: 3, createdAt: d(30) },
  { id: "kt2", name: "Sabr", linkCount: 2, createdAt: d(25) },
  { id: "kt3", name: "Taqwa", linkCount: 4, createdAt: d(20) },
];

export const knowledgeTagLinks: Record<string, KnowledgeTagLink[]> = {
  "kt1": [
    { tagId: "kt1", targetType: "note", targetId: "in1", createdAt: d(29) },
    { tagId: "kt1", targetType: "note", targetId: "in3", createdAt: d(14) },
    { tagId: "kt1", targetType: "attachment", targetId: "a5", createdAt: d(6) },
  ],
  "kt2": [
    { tagId: "kt2", targetType: "note", targetId: "in3", createdAt: d(14) },
    { tagId: "kt2", targetType: "note", targetId: "in4", createdAt: d(9) },
  ],
  "kt3": [
    { tagId: "kt3", targetType: "note", targetId: "in1", createdAt: d(19) },
    { tagId: "kt3", targetType: "note", targetId: "in2", createdAt: d(6) },
    { tagId: "kt3", targetType: "note", targetId: "in5", createdAt: d(13) },
    { tagId: "kt3", targetType: "attachment", targetId: "a5", createdAt: d(6) },
  ],
};

// ─── HOME SNAPSHOT ────────────────────────────────────────────────────────────

export const personalHomeSnapshot: HomeSnapshot = {
  recentNotes: [personalNotes[0], personalNotes[5], personalNotes[2], personalNotes[8], personalNotes[3]],
  pinnedNotes: [personalNotes[0], personalNotes[3], personalNotes[8]],
  stats: { totalNotes: 10, totalFolders: 9, totalAttachments: 5, totalTags: 5, totalWordCount: 3350 },
  recentFolders: [personalFolders[1], personalFolders[5], personalFolders[7]],
};

export const islamicHomeSnapshot: HomeSnapshot = {
  recentNotes: [islamicNotes[0], islamicNotes[2], islamicNotes[1], islamicNotes[3]],
  pinnedNotes: [islamicNotes[0], islamicNotes[3]],
  stats: { totalNotes: 6, totalFolders: 4, totalAttachments: 1, totalTags: 0, totalWordCount: 2520 },
  recentFolders: [islamicFolders[0], islamicFolders[1]],
};

// ─── SEARCH ───────────────────────────────────────────────────────────────────

export const allSearchItems: SearchResults = {
  query: "",
  items: [
    ...allNotes.map(n => ({ type: "note" as const, id: n.id, title: n.title, snippet: n.bodyPreview ?? null, folderId: n.folderId ?? null, folderTitle: allFolders.find(f => f.id === n.folderId)?.title ?? null, updatedAt: n.updatedAt })),
    ...attachments.map(a => ({ type: "attachment" as const, id: a.id, title: a.name, snippet: null, folderId: a.libraryFolderId ?? null, folderTitle: null, updatedAt: a.updatedAt })),
  ]
};
