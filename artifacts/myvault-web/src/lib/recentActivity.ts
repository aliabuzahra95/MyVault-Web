export type RecentActivityKind = "note" | "document" | "course";

export type RecentActivityEntry = {
  kind: RecentActivityKind;
  id: string;
  openedAt: number;
};

const STORAGE_KEY = "myvault-recent-activity-v1";
const MAX_ENTRIES = 60;

export function loadRecentActivity(): RecentActivityEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is RecentActivityEntry => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<RecentActivityEntry>;
      return (
        (candidate.kind === "note" || candidate.kind === "document" || candidate.kind === "course")
        && typeof candidate.id === "string"
        && typeof candidate.openedAt === "number"
      );
    });
  } catch {
    return [];
  }
}

export function recordRecentActivity(kind: RecentActivityKind, id: string) {
  if (!id) return;
  const next = [
    { kind, id, openedAt: Date.now() },
    ...loadRecentActivity().filter((entry) => entry.kind !== kind || entry.id !== id),
  ].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function clearRecentActivity() {
  localStorage.removeItem(STORAGE_KEY);
}

export function orderByRecentActivity<T extends { id: string }>(items: T[], kind: RecentActivityKind) {
  const activityIds = loadRecentActivity()
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.id);
  const position = new Map(activityIds.map((id, index) => [id, index]));

  return [...items].sort((first, second) => {
    const firstPosition = position.get(first.id);
    const secondPosition = position.get(second.id);
    if (firstPosition == null && secondPosition == null) return 0;
    if (firstPosition == null) return 1;
    if (secondPosition == null) return -1;
    return firstPosition - secondPosition;
  });
}
