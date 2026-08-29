export type GoogleDriveStartupAction = "setup-needed" | "disconnected" | "validate-token" | "renew-token";

export function getGoogleDriveStartupAction({
  configured,
  hasUsableToken,
  previouslyAuthorized,
}: {
  configured: boolean;
  hasUsableToken: boolean;
  previouslyAuthorized: boolean;
}): GoogleDriveStartupAction {
  if (!configured) return "setup-needed";
  if (hasUsableToken) return "validate-token";
  if (previouslyAuthorized) return "renew-token";
  return "disconnected";
}
