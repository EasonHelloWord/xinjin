const TOKEN_KEY = "xinjin_token";
const FORCE_LOGIN_PROMPT_KEY = "xinjin_force_login_prompt";
export const AUTH_SESSION_CHANGED = "xinjin_auth_session_changed";

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

const emitAuthSessionChanged = (): void => {
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED));
};

const readStoredSession = (): AuthSession | null => {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (typeof parsed.accessToken === "string" && parsed.accessToken.length > 0) {
      return {
        accessToken: parsed.accessToken,
        refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
        expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined
      };
    }
  } catch {
    // Existing installs stored the raw access token string.
  }

  return { accessToken: raw };
};

export const getAuthSession = (): AuthSession | null => readStoredSession();

export const getAuthToken = (): string | null => readStoredSession()?.accessToken ?? null;

export const getRefreshToken = (): string | null => readStoredSession()?.refreshToken ?? null;

export const getAuthExpiresAt = (): number | null => readStoredSession()?.expiresAt ?? null;

export const setAuthSession = (session: AuthSession): void => {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
  emitAuthSessionChanged();
};

export const setAuthToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
  emitAuthSessionChanged();
};

export const clearAuthToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  emitAuthSessionChanged();
};

export const markLoginPromptRequired = (): void => {
  localStorage.setItem(FORCE_LOGIN_PROMPT_KEY, "1");
};

export const consumeLoginPromptRequired = (): boolean => {
  const required = localStorage.getItem(FORCE_LOGIN_PROMPT_KEY) === "1";
  localStorage.removeItem(FORCE_LOGIN_PROMPT_KEY);
  return required;
};

export const isAuthenticated = (): boolean => Boolean(getAuthToken());
