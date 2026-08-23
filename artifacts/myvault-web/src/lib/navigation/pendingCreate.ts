export const PENDING_CREATE_EVENT = "myvault:pending-create";

const STORAGE_KEY = "myvault-pending-create-v1";

export type PendingCreateRequest = {
  section: "study" | "library" | "course";
  folderId: string;
  type: "folder" | "note" | "sticky" | "upload";
  courseId?: string;
};

export function queuePendingCreate(request: PendingCreateRequest, notify = true) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(request));
  if (notify) window.dispatchEvent(new Event(PENDING_CREATE_EVENT));
}

export function consumePendingCreate(section: PendingCreateRequest["section"], courseId?: string) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const request = JSON.parse(raw) as PendingCreateRequest;
    if (request.section !== section || (section === "course" && request.courseId !== courseId)) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return request;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
