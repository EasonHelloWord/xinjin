import { clearAuthToken, getRefreshToken, setAuthSession } from "./auth";

const OIDC_STATE_KEY = "xinjin_oidc_state";
const OIDC_VERIFIER_KEY = "xinjin_oidc_code_verifier";
const OIDC_RETURN_KEY = "xinjin_oidc_return_to";

const trimSlash = (value: string): string => value.replace(/\/+$/, "");
const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const randomString = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
};

const sha256Challenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
};

export const oidcConfig = {
  issuer: trimSlash((import.meta.env.VITE_OIDC_ISSUER as string | undefined) || "https://auth.easonjan.top"),
  clientId: (import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined) || "xinjin",
  scope: (import.meta.env.VITE_OIDC_SCOPE as string | undefined) || "openid profile email"
};

export const getRedirectUri = (): string => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}/auth/callback`;
};

const getSameOriginOauthBase = (): string => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}/oauth`;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error_description?: string;
  error?: string;
};

const toExpiresAt = (expiresIn: number | undefined): number | undefined =>
  typeof expiresIn === "number" && Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : undefined;

export const startOidcLogin = async (options?: { register?: boolean; promptLogin?: boolean; returnTo?: string }): Promise<void> => {
  const state = randomString();
  const nonce = randomString();
  const verifier = randomString();
  const challenge = await sha256Challenge(verifier);
  const returnTo = options?.returnTo || "/";

  sessionStorage.setItem(OIDC_STATE_KEY, state);
  sessionStorage.setItem(OIDC_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OIDC_RETURN_KEY, returnTo);

  const authorizeUrl = new URL(`${oidcConfig.issuer}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", oidcConfig.clientId);
  authorizeUrl.searchParams.set("redirect_uri", getRedirectUri());
  authorizeUrl.searchParams.set("scope", oidcConfig.scope);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  if (options?.promptLogin) {
    authorizeUrl.searchParams.set("prompt", "login");
  }

  if (options?.register) {
    window.location.href = `${oidcConfig.issuer}/register?return_to=${encodeURIComponent(
      `${authorizeUrl.pathname}${authorizeUrl.search}`
    )}`;
    return;
  }

  window.location.href = authorizeUrl.toString();
};

export const finishOidcLogin = async (code: string, state: string): Promise<string> => {
  const expectedState = sessionStorage.getItem(OIDC_STATE_KEY);
  const verifier = sessionStorage.getItem(OIDC_VERIFIER_KEY);
  if (!expectedState || expectedState !== state || !verifier) {
    throw new Error("登录状态已失效，请重新登录。");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: oidcConfig.clientId,
    redirect_uri: getRedirectUri(),
    code,
    code_verifier: verifier
  });

  const res = await fetch(`${getSameOriginOauthBase()}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = (await res.json()) as TokenResponse;
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "登录失败。");
  }

  sessionStorage.removeItem(OIDC_STATE_KEY);
  sessionStorage.removeItem(OIDC_VERIFIER_KEY);
  const returnTo = sessionStorage.getItem(OIDC_RETURN_KEY) || "/mind";
  sessionStorage.removeItem(OIDC_RETURN_KEY);
  setAuthSession({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: toExpiresAt(payload.expires_in)
  });
  return returnTo;
};

export const refreshOidcLogin = async (): Promise<string | null> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: oidcConfig.clientId,
    refresh_token: refreshToken
  });

  const res = await fetch(`${getSameOriginOauthBase()}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = (await res.json()) as TokenResponse;
  if (!res.ok || !payload.access_token) {
    clearAuthToken();
    return null;
  }

  setAuthSession({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expiresAt: toExpiresAt(payload.expires_in)
  });
  return payload.access_token;
};
