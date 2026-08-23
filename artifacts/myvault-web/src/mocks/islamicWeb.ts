import { BookOpen, FileText, GraduationCap, Library, StickyNote } from "lucide-react";

export const restoreSteps = [
  { id: "connect", label: "Connect Google Drive", status: "ready" },
  { id: "manifest", label: "Find MyVault manifest", status: "waiting" },
  { id: "metadata", label: "Restore metadata", status: "waiting" },
  { id: "files", label: "Restore files", status: "waiting" },
  { id: "review", label: "Review restored corpus", status: "waiting" },
];

export const restorePreview = [
  { label: "Courses", value: 3, icon: GraduationCap },
  { label: "Library files", value: 18, icon: Library },
  { label: "Study notes", value: 42, icon: FileText },
  { label: "Sticky notes", value: 12, icon: StickyNote },
];

export const courses = [
  {
    id: "course-aqida",
    title: "Usul al-Tafsir",
    description: "12 Lessons",
    noteCount: 12,
    conceptCount: 48,
    updatedLabel: "48% complete",
    accent: "emerald",
  },
  {
    id: "course-fiqh",
    title: "Aqidah Tahawiyyah",
    description: "24 Lessons",
    noteCount: 24,
    conceptCount: 20,
    updatedLabel: "20% complete",
    accent: "amber",
  },
  {
    id: "course-hadith",
    title: "Riyad as-Salihin",
    description: "40 Lessons",
    noteCount: 40,
    conceptCount: 65,
    updatedLabel: "65% complete",
    accent: "sky",
  },
];

export const libraryDocuments = [
  {
    id: "doc-tafsir",
    title: "Tafsir Ibn Kathir - Juz 1",
    detail: "PDF  •  18.4 MB  •  8 Jul 2025",
    folder: "Tafsir",
  },
  {
    id: "doc-usul",
    title: "Fiqh Notes - Taharah",
    detail: "DOCX  •  1.2 MB  •  7 Jul 2025",
    folder: "Fiqh",
  },
  {
    id: "doc-hadith",
    title: "40 Hadith Nawawi",
    detail: "PDF  •  2.1 MB  •  6 Jul 2025",
    folder: "Hadith",
  },
];

export const studyNotes = [
  {
    id: "in1",
    title: "Reflection on Surah Al-Baqarah (Ayah 1-20)",
    preview: "8 Jul 2025  •  Quran Study",
    folder: "Quran Study",
  },
  {
    id: "in3",
    title: "Shaykh Ibn Uthaymeen - Notes",
    preview: "7 Jul 2025  •  Aqidah",
    folder: "Aqidah",
  },
  {
    id: "in5",
    title: "Lessons from Riyad as-Salihin (Hadith 1-10)",
    preview: "6 Jul 2025  •  Hadith",
    folder: "Hadith",
  },
];

export const quranPlaceholderItems = [
  { label: "Reader shell", value: "Planned" },
  { label: "Recent location", value: "Restore later" },
  { label: "Reader tools", value: "Later phase" },
];

export const corpusStats = [
  { label: "Courses", value: "3", icon: GraduationCap },
  { label: "Library", value: "18", icon: Library },
  { label: "Study notes", value: "42", icon: FileText },
  { label: "Quran", value: "Later", icon: BookOpen },
];
