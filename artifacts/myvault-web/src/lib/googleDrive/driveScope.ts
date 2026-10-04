export function hasSufficientDriveScope(scope?: string | null): boolean {
  const granted = new Set(scope?.trim().split(/\s+/) ?? []);
  return granted.has("https://www.googleapis.com/auth/drive.readonly")
    || granted.has("https://www.googleapis.com/auth/drive");
}
