import { CLIENT_ID, CLIENT_SECRET, TOKEN_URL, USERINFO_URL } from "../config.js";
import { jsonFetch } from "../http.js";
import type { CredentialStore, Credentials } from "./credentials.js";

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
}

/** 만료 5분 전을 미리 당겨 저장한다(원본과 동일). */
function expiryFrom(expiresIn: number): number {
  return Date.now() + expiresIn * 1000 - 5 * 60 * 1000;
}

export async function exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> {
  const data = await jsonFetch<TokenResponse>("token 교환", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!data.refresh_token) throw new Error("refresh_token 이 안 왔다. prompt=consent 로 다시 시도해야 한다");
  return data;
}

export async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const data = await jsonFetch<{ email?: string }>("userinfo", USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data.email;
  } catch {
    return undefined;
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return jsonFetch<TokenResponse>("token refresh", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
}

export interface RefreshResult {
  readonly refreshed: boolean;
  readonly credentials: Credentials;
}

/**
 * 만료됐으면 갱신해 저장하고, 유효하면 그대로 돌려준다.
 * 갱신은 프로세스 안에서 한 번에 하나만 날린다 — 만료 직후 동시 요청이
 * 다중 refresh 로 refresh token 회전을 클러버하지 않게 single-flight 로 묶는다.
 */
const inflights = new WeakMap<CredentialStore, Promise<RefreshResult | null>>();

export function ensureFreshAccess(store: CredentialStore): Promise<RefreshResult | null> {
  const existing = inflights.get(store);
  if (existing) return existing;
  const task = (async (): Promise<RefreshResult | null> => {
    try {
      const current = await store.read();
      if (!current) return null;
      if (Date.now() < current.expires) return { refreshed: false, credentials: current };
      const data = await refreshAccessToken(current.refresh);
      const next: Credentials = {
        ...current,
        refresh: data.refresh_token ?? current.refresh,
        access: data.access_token,
        expires: expiryFrom(data.expires_in),
      };
      await store.write(next);
      return { refreshed: true, credentials: next };
    } finally {
      inflights.delete(store);
    }
  })();
  inflights.set(store, task);
  return task;
}

export function credentialsFromToken(
  token: TokenResponse,
  projectId: string,
  email: string | undefined,
  previousRefresh?: string,
): Credentials {
  const refresh = token.refresh_token ?? previousRefresh;
  if (!refresh) throw new Error("refresh_token 이 없다");
  return {
    refresh,
    access: token.access_token,
    expires: expiryFrom(token.expires_in),
    projectId,
    ...(email === undefined ? {} : { email }),
  };
}
