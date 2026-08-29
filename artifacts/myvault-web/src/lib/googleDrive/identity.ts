import { createSingleFlight } from "@/lib/googleDrive/singleFlight";

export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
export const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

export type GoogleDriveToken = {
  accessToken: string;
  expiresAt: number;
  scope: string;
};

type GoogleCodeResponse = {
  code?: string;
  error?: string;
  error_description?: string;
};

type GoogleDriveServerSession = GoogleDriveToken & {
  accountId: string;
  error?: string;
  interactionRequired?: boolean;
};

export type GoogleDriveAuthFailureKind = "interaction-required" | "network" | "configuration" | "unknown";

export class GoogleDriveAuthError extends Error {
  constructor(message: string, readonly kind: GoogleDriveAuthFailureKind, readonly causeValue?: unknown) {
    super(message);
    this.name = "GoogleDriveAuthError";
  }
}

type GoogleCodeClient = { requestCode: () => void };

type GoogleOAuth2Api = {
  initCodeClient: (config: {
    client_id: string;
    scope: string;
    ux_mode: "popup";
    access_type: "offline";
    include_granted_scopes: boolean;
    prompt?: "consent" | "select_account";
    callback: (response: GoogleCodeResponse) => void;
    error_callback?: (error: unknown) => void;
  }) => GoogleCodeClient;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2Api } };
  }
}

let scriptLoadPromise: Promise<void> | null = null;
const runTokenRequest = createSingleFlight<GoogleDriveToken>();
let accountSelectionGeneration = 0;
let cachedToken: GoogleDriveToken | null = null;
const LEGACY_SESSION_TOKEN_KEY = "myvault-google-drive-token";
const LEGACY_SHARED_TOKEN_KEY = "myvault-google-drive-session";
const AUTHORIZATION_KEY = "myvault-google-drive-authorized";
const SESSION_VERSION_KEY = "myvault-google-drive-session-version";
const SESSION_CHANGE_EVENT = "myvault-google-drive-session-changed";

type GoogleDriveTokenRequestOptions = {
  forceRefresh?: boolean;
  interactive?: boolean;
  selectAccount?: boolean;
};

export function hasGoogleClientId() {
  return GOOGLE_CLIENT_ID.length > 0;
}

function removeLegacyBrowserTokens() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_SHARED_TOKEN_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
}

export function getCachedGoogleDriveToken() {
  if (typeof window === "undefined") return null;
  removeLegacyBrowserTokens();
  if (!cachedToken || cachedToken.expiresAt - Date.now() <= 60000) {
    cachedToken = null;
    return null;
  }
  return cachedToken;
}

if (typeof window !== "undefined") {
  removeLegacyBrowserTokens();
  window.addEventListener("storage", (event) => {
    if (event.key !== SESSION_VERSION_KEY) return;
    cachedToken = null;
    window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
  });
}

function notifySessionChanged(broadcast: boolean) {
  if (typeof window === "undefined") return;
  if (broadcast) localStorage.setItem(SESSION_VERSION_KEY, crypto.randomUUID());
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

export function rememberGoogleDriveToken(token: GoogleDriveToken, options: { broadcast?: boolean } = {}) {
  cachedToken = token;
  if (typeof window !== "undefined") {
    localStorage.setItem(AUTHORIZATION_KEY, "true");
    removeLegacyBrowserTokens();
    if (options.broadcast === true) notifySessionChanged(true);
  }
  return token;
}

export function clearCachedGoogleDriveToken(options: { broadcast?: boolean } = {}) {
  cachedToken = null;
  if (typeof window === "undefined") return;
  removeLegacyBrowserTokens();
  if (options.broadcast === true) notifySessionChanged(true);
}

export async function disconnectGoogleDrive(_options: { revoke?: boolean } = {}) {
  try {
    await fetch("/api/google-drive-auth", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } finally {
    clearCachedGoogleDriveToken({ broadcast: true });
    if (typeof window !== "undefined") {
      localStorage.removeItem(AUTHORIZATION_KEY);
      localStorage.removeItem("myvault-google-drive-profile");
    }
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
    "needs to be restored",
    "connect again",
  ].some((marker) => normalized.includes(marker));
  const network = normalized.includes("network") || normalized.includes("failed to fetch");
  const configuration = normalized.includes("server authentication needs");
  return new GoogleDriveAuthError(
    interactionRequired ? "Reconnect Google Drive to continue." : source,
    interactionRequired ? "interaction-required" : network ? "network" : configuration ? "configuration" : "unknown",
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
  if (isGoogleIdentityReady()) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
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

async function parseServerSession(response: Response) {
  const payload = await response.json().catch(() => ({})) as Partial<GoogleDriveServerSession>;
  if (!response.ok || typeof payload.accessToken !== "string" || typeof payload.expiresAt !== "number" || typeof payload.scope !== "string") {
    const message = typeof payload.error === "string" ? payload.error : "Google Drive session could not be restored.";
    throw new GoogleDriveAuthError(
      payload.interactionRequired || response.status === 401 ? "Reconnect Google Drive to continue." : message,
      payload.interactionRequired || response.status === 401
        ? "interaction-required"
        : response.status === 503
          ? "configuration"
          : "unknown",
      payload,
    );
  }
  return {
    accessToken: payload.accessToken,
    expiresAt: payload.expiresAt,
    scope: payload.scope,
  } satisfies GoogleDriveToken;
}

async function restoreServerSession() {
  let response: Response;
  try {
    response = await fetch("/api/google-drive-auth", {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw authErrorFrom(error, "Google Drive session could not be restored.");
  }
  return rememberGoogleDriveToken(await parseServerSession(response));
}

async function requestAuthorizationCode(selectAccount: boolean) {
  await loadGoogleIdentityScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google sign-in is not ready yet. Please try again.");
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(authErrorFrom("Google sign-in did not finish. The popup may have been closed.", "Google sign-in did not finish."));
      }
    }, 120000);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      callback();
    };
    const client = oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      ux_mode: "popup",
      access_type: "offline",
      include_granted_scopes: true,
      prompt: selectAccount ? "select_account" : "consent",
      callback: (response) => finish(() => {
        if (response.error) {
          reject(authErrorFrom(response.error_description || response.error, "Google sign-in failed."));
        } else if (!response.code) {
          reject(new Error("Google did not return an authorization code."));
        } else {
          resolve(response.code);
        }
      }),
      error_callback: (error) => finish(() => reject(authErrorFrom(error, "Google sign-in failed."))),
    });
    try {
      client.requestCode();
    } catch (error) {
      finish(() => reject(authErrorFrom(error, "Google sign-in could not start.")));
    }
  });
}

async function exchangeAuthorizationCode(code: string) {
  let response: Response;
  try {
    response = await fetch("/api/google-drive-auth", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch (error) {
    throw authErrorFrom(error, "Google Drive connection could not be completed.");
  }
  return parseServerSession(response);
}

export async function requestGoogleDriveToken(options: GoogleDriveTokenRequestOptions = {}): Promise<GoogleDriveToken> {
  const existingToken = options.forceRefresh ? null : getCachedGoogleDriveToken();
  if (existingToken) return existingToken;
  if (!hasGoogleClientId()) {
    throw new GoogleDriveAuthError("Google Drive setup needs a VITE_GOOGLE_CLIENT_ID value.", "configuration");
  }

  const selectionGeneration = accountSelectionGeneration;
  const token = await runTokenRequest(async () => {
    const shouldSelectAccount = options.selectAccount === true;
    const previouslyAuthorized = hasPreviousGoogleDriveAuthorization();
    if (!shouldSelectAccount && previouslyAuthorized) {
      try {
        return await restoreServerSession();
      } catch (error) {
        if (options.interactive === false || !isGoogleDriveInteractionRequired(error)) throw error;
      }
    }
    if (options.interactive === false) {
      throw new GoogleDriveAuthError("Reconnect Google Drive to continue.", "interaction-required");
    }
    accountSelectionGeneration += 1;
    const code = await requestAuthorizationCode(shouldSelectAccount);
    return rememberGoogleDriveToken(await exchangeAuthorizationCode(code), { broadcast: true });
  });

  if (options.selectAccount && accountSelectionGeneration === selectionGeneration) {
    return requestGoogleDriveToken(options);
  }
  return token;
}
