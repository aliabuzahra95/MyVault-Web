import { createSingleFlight } from "@/lib/googleDrive/singleFlight";

export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
export const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

export type GoogleDriveToken = {
  accessToken: string;
  expiresAt: number;
  scope: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export type GoogleDriveAuthFailureKind = "interaction-required" | "network" | "configuration" | "unknown";

export class GoogleDriveAuthError extends Error {
  constructor(message: string, readonly kind: GoogleDriveAuthFailureKind, readonly causeValue?: unknown) {
    super(message);
    this.name = "GoogleDriveAuthError";
  }
}

type GoogleTokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: "" | "consent" | "select_account" }) => void;
};

type GoogleOAuth2Api = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: unknown) => void;
  }) => GoogleTokenClient;
  revoke?: (accessToken: string, done?: () => void) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleOAuth2Api;
      };
    };
  }
}

let scriptLoadPromise: Promise<void> | null = null;
const runTokenRequest = createSingleFlight<GoogleDriveToken>();
let accountSelectionGeneration = 0;
let cachedToken: GoogleDriveToken | null = null;
const LEGACY_SESSION_TOKEN_KEY = "myvault-google-drive-token";
const SHARED_TOKEN_KEY = "myvault-google-drive-session";
const AUTHORIZATION_KEY = "myvault-google-drive-authorized";
const SESSION_CHANGE_EVENT = "myvault-google-drive-session-changed";

type GoogleDriveTokenRequestOptions = {
  forceRefresh?: boolean;
  interactive?: boolean;
  selectAccount?: boolean;
};

export function hasGoogleClientId() {
  return GOOGLE_CLIENT_ID.length > 0;
}

export function getCachedGoogleDriveToken() {
  if (typeof window === "undefined") return null;

  try {
    // localStorage is the cross-tab source of truth. Reading the module cache
    // first can leave an older tab using account A briefly after another tab
    // has selected account B.
    const stored = localStorage.getItem(SHARED_TOKEN_KEY) ?? sessionStorage.getItem(LEGACY_SESSION_TOKEN_KEY);
    if (!stored) {
      cachedToken = null;
      return null;
    }
    const parsed = JSON.parse(stored) as GoogleDriveToken;
    if (typeof parsed.accessToken !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt - Date.now() <= 60000) {
      clearCachedGoogleDriveToken();
      return null;
    }
    cachedToken = parsed;
    localStorage.setItem(SHARED_TOKEN_KEY, JSON.stringify(parsed));
    sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    return parsed;
  } catch {
    clearCachedGoogleDriveToken();
    return null;
  }
}

function parseStoredGoogleDriveToken(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as GoogleDriveToken;
    return typeof parsed.accessToken === "string"
      && typeof parsed.expiresAt === "number"
      && parsed.expiresAt - Date.now() > 60000
      ? parsed
      : null;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== SHARED_TOKEN_KEY) return;
    cachedToken = parseStoredGoogleDriveToken(event.newValue);
    window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
  });
}

export function rememberGoogleDriveToken(token: GoogleDriveToken) {
  cachedToken = token;
  if (typeof window !== "undefined") {
    localStorage.setItem(SHARED_TOKEN_KEY, JSON.stringify(token));
    localStorage.setItem(AUTHORIZATION_KEY, "true");
    sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
  }
  return token;
}

export function clearCachedGoogleDriveToken() {
  cachedToken = null;
  if (typeof window === "undefined") return;
  localStorage.removeItem(SHARED_TOKEN_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

export async function disconnectGoogleDrive(options: { revoke?: boolean } = {}) {
  const token = getCachedGoogleDriveToken();
  clearCachedGoogleDriveToken();

  if (typeof window !== "undefined") {
    localStorage.removeItem(AUTHORIZATION_KEY);
    localStorage.removeItem("myvault-google-drive-profile");
  }

  if (!options.revoke || !token) {
    return;
  }

  try {
    await loadGoogleIdentityScript();
    const revoke = window.google?.accounts?.oauth2?.revoke;
    if (!revoke) return;
    await new Promise<void>((resolve) => revoke(token.accessToken, resolve));
  } catch {
    // The local session is already disconnected even if Google cannot be reached.
  }
}

export function hasPreviousGoogleDriveAuthorization() {
  return typeof window !== "undefined" && localStorage.getItem(AUTHORIZATION_KEY) === "true";
}

export function isGoogleDriveInteractionRequired(error: unknown) {
  return error instanceof GoogleDriveAuthError && error.kind === "interaction-required";
}

function authErrorFrom(value: unknown, fallback: string) {
  const source = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  const normalized = source.toLowerCase();
  const interactionRequired = [
    "interaction_required",
    "login_required",
    "consent_required",
    "popup_closed",
    "popup_failed_to_open",
    "popup may have been closed",
  ].some((marker) => normalized.includes(marker));
  const network = normalized.includes("network") || normalized.includes("failed to fetch");
  return new GoogleDriveAuthError(
    interactionRequired ? "Reconnect Google Drive to continue." : source,
    interactionRequired ? "interaction-required" : network ? "network" : "unknown",
    value,
  );
}

function isGoogleIdentityReady() {
  return typeof window !== "undefined" && window.google?.accounts?.oauth2 !== undefined;
}

function waitForExistingScript(script: HTMLScriptElement) {
  return new Promise<void>((resolve, reject) => {
    if (isGoogleIdentityReady()) {
      resolve();
      return;
    }

    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Google Identity script could not be loaded.")), { once: true });
  });
}

export function loadGoogleIdentityScript() {
  if (isGoogleIdentityReady()) {
    return Promise.resolve();
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google sign-in can only run in a browser."));
  }

  const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT_SRC}"]`);
  if (existingScript) {
    scriptLoadPromise = waitForExistingScript(existingScript);
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Google Identity script could not be loaded.")), { once: true });
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

export async function requestGoogleDriveToken(options: GoogleDriveTokenRequestOptions = {}): Promise<GoogleDriveToken> {
  const existingToken = options.forceRefresh ? null : getCachedGoogleDriveToken();
  if (existingToken) return existingToken;
  if (!hasGoogleClientId()) {
    throw new GoogleDriveAuthError("Google Drive setup needs a VITE_GOOGLE_CLIENT_ID value.", "configuration");
  }

  const selectionGeneration = accountSelectionGeneration;
  const token = await runTokenRequest(async () => {
    await loadGoogleIdentityScript();

    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      throw new Error("Google sign-in is not ready yet. Please try again.");
    }

    const shouldSelectAccount = options.selectAccount || (options.interactive !== false && !hasPreviousGoogleDriveAuthorization());
    const result = await new Promise<GoogleDriveToken>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(authErrorFrom("Google sign-in did not finish. The popup may have been closed.", "Google sign-in did not finish."));
        }
      }, 120000);

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        callback();
      };

      const client = oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: (response) => {
          finish(() => {
            if (response.error) {
              reject(authErrorFrom(response.error_description || response.error, "Google sign-in failed."));
              return;
            }

            if (!response.access_token) {
              reject(new Error("Google did not return an access token."));
              return;
            }

            const expiresInSeconds = response.expires_in ?? 3600;
            resolve(rememberGoogleDriveToken({
              accessToken: response.access_token,
              expiresAt: Date.now() + expiresInSeconds * 1000,
              scope: response.scope ?? GOOGLE_DRIVE_SCOPE,
            }));
          });
        },
        error_callback: (error) => {
          finish(() => reject(authErrorFrom(error, "Google sign-in failed.")));
        },
      });

      try {
        client.requestAccessToken({ prompt: shouldSelectAccount ? "select_account" : "" });
      } catch (error) {
        finish(() => reject(authErrorFrom(error, "Google sign-in could not start.")));
      }
    });
    if (shouldSelectAccount) accountSelectionGeneration += 1;
    return result;
  });
  // If an explicit account switch joined an already-running silent renewal,
  // run the chooser once that renewal has settled instead of accepting its account.
  if (options.selectAccount && accountSelectionGeneration === selectionGeneration) {
    return requestGoogleDriveToken(options);
  }
  return token;
}
