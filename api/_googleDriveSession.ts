import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_ABOUT_ENDPOINT = "https://www.googleapis.com/drive/v3/about?fields=user(permissionId)";
const SESSION_COOKIE = "myvault_google_drive_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type GoogleTokenExchange = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type DriveAboutResponse = {
  user?: {
    permissionId?: string;
  };
};

type SealedSession = {
  accountId: string;
  issuedAt: number;
  refreshToken: string;
};

type PublicSession = {
  accessToken: string;
  accountId: string;
  expiresAt: number;
  scope: string;
};

type GoogleDriveAuthEnvironment = {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
};

function getEnvironment(): GoogleDriveAuthEnvironment {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
    || process.env.VITE_GOOGLE_CLIENT_ID?.trim()
    || "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
  const sessionSecret = process.env.MYVAULT_GOOGLE_SESSION_SECRET?.trim() || "";

  if (!clientId || !clientSecret || sessionSecret.length < 32) {
    throw new Error(
      "Google Drive server authentication needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and a MYVAULT_GOOGLE_SESSION_SECRET of at least 32 characters.",
    );
  }

  return { clientId, clientSecret, sessionSecret };
}

function sessionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function sealSession(session: SealedSession, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function openSession(value: string, secret: string): SealedSession | null {
  try {
    const sealed = Buffer.from(value, "base64url");
    if (sealed.length < 29) return null;
    const iv = sealed.subarray(0, 12);
    const tag = sealed.subarray(12, 28);
    const encrypted = sealed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(secret), iv);
    decipher.setAuthTag(tag);
    const parsed = JSON.parse(Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8")) as Partial<SealedSession>;
    if (
      typeof parsed.accountId !== "string"
      || typeof parsed.refreshToken !== "string"
      || typeof parsed.issuedAt !== "number"
    ) return null;
    return parsed as SealedSession;
  } catch {
    return null;
  }
}

function parseCookies(request: Request) {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies.set(key, value);
  }
  return cookies;
}

function isSecureRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded ? forwarded === "https" : new URL(request.url).protocol === "https:";
}

function sessionCookie(value: string, request: Request) {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    isSecureRequest(request) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function clearSessionCookie(request: Request) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    isSecureRequest(request) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function jsonResponse(request: Request, body: unknown, status = 200, cookie?: string) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    pragma: "no-cache",
    vary: "Cookie",
  });
  if (cookie !== undefined) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const expectedOrigin = forwardedHost
    ? `${forwardedProto || requestUrl.protocol.slice(0, -1)}://${forwardedHost}`
    : requestUrl.origin;
  if (origin !== expectedOrigin) throw new Error("Cross-origin Google Drive session request rejected.");
}

async function postTokenForm(values: Record<string, string>): Promise<GoogleTokenExchange> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const payload = await response.json() as GoogleTokenExchange;
  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.error_description || payload.error || "Google token exchange failed.");
    Object.assign(error, { status: response.status, oauthError: payload.error });
    throw error;
  }
  return payload;
}

async function accountIdForAccessToken(accessToken: string) {
  const response = await fetch(GOOGLE_DRIVE_ABOUT_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json() as DriveAboutResponse;
  const accountId = payload.user?.permissionId;
  if (!response.ok || !accountId) {
    throw new Error("Google Drive account identity could not be verified.");
  }
  return accountId;
}

function publicSession(token: GoogleTokenExchange, accountId: string): PublicSession {
  return {
    accessToken: token.access_token!,
    accountId,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    scope: token.scope || "https://www.googleapis.com/auth/drive.file",
  };
}

function readSession(request: Request, secret: string) {
  const value = parseCookies(request).get(SESSION_COOKIE);
  return value ? openSession(value, secret) : null;
}

async function exchangeAuthorizationCode(request: Request, environment: GoogleDriveAuthEnvironment) {
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  if (typeof body?.code !== "string" || body.code.length < 4) {
    return jsonResponse(request, { error: "A Google authorization code is required." }, 400);
  }

  const token = await postTokenForm({
    code: body.code,
    client_id: environment.clientId,
    client_secret: environment.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: "postmessage",
  });
  const accountId = await accountIdForAccessToken(token.access_token!);
  const previous = readSession(request, environment.sessionSecret);
  const refreshToken = token.refresh_token
    || (previous?.accountId === accountId ? previous.refreshToken : null);
  if (!refreshToken) {
    return jsonResponse(
      request,
      { error: "Google did not provide durable Drive access. Please connect again and approve access." },
      401,
      clearSessionCookie(request),
    );
  }
  const sealed = sealSession({ accountId, issuedAt: Date.now(), refreshToken }, environment.sessionSecret);
  return jsonResponse(request, publicSession(token, accountId), 200, sessionCookie(sealed, request));
}

async function refreshAuthorizedSession(request: Request, environment: GoogleDriveAuthEnvironment) {
  const session = readSession(request, environment.sessionSecret);
  if (!session) {
    return jsonResponse(request, { error: "Google Drive connection needs to be restored.", interactionRequired: true }, 401);
  }
  const token = await postTokenForm({
    client_id: environment.clientId,
    client_secret: environment.clientSecret,
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });
  const accountId = await accountIdForAccessToken(token.access_token!);
  if (accountId !== session.accountId) {
    return jsonResponse(
      request,
      { error: "The restored Google account did not match the connected MyVault account.", interactionRequired: true },
      401,
      clearSessionCookie(request),
    );
  }
  const sealed = sealSession({ ...session, issuedAt: Date.now() }, environment.sessionSecret);
  return jsonResponse(request, publicSession(token, accountId), 200, sessionCookie(sealed, request));
}

export async function handleGoogleDriveAuthRequest(request: Request) {
  try {
    assertSameOrigin(request);
    const environment = getEnvironment();
    if (request.method === "GET") return await refreshAuthorizedSession(request, environment);
    if (request.method === "POST") return await exchangeAuthorizationCode(request, environment);
    if (request.method === "DELETE") {
      return jsonResponse(request, { disconnected: true }, 200, clearSessionCookie(request));
    }
    return jsonResponse(request, { error: "Method not allowed." }, 405);
  } catch (error) {
    const details = error as { message?: string; oauthError?: string; status?: number };
    const interactionRequired = details.oauthError === "invalid_grant" || details.status === 401;
    const status = interactionRequired ? 401 : details.message?.includes("needs ") ? 503 : 500;
    return jsonResponse(
      request,
      { error: details.message || "Google Drive authentication failed.", interactionRequired },
      status,
      interactionRequired ? clearSessionCookie(request) : undefined,
    );
  }
}

