export const PENDING_MANAGE_EVENT = "myvault:pending-manage";

const STORAGE_KEY = "myvault-pending-manage-v1";

export type PendingManageRequest = {
  section: "study" | "library" | "course";
  kind: "course" | "folder" | "note" | "attachment" | "sticky" | "concept";
  itemId: string;
  courseId?: string;
};

export function queuePendingManage(request: PendingManageRequest, notify = true) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(request));
  if (notify) window.dispatchEvent(new Event(PENDING_MANAGE_EVENT));
}

export function consumePendingManage(section: PendingManageRequest["section"]) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const request = JSON.parse(raw) as PendingManageRequest;
    if (request.section !== section) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return request;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
