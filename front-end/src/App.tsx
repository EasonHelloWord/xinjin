import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AUTH_SESSION_CHANGED, clearAuthToken, getAuthExpiresAt, getAuthToken, markLoginPromptRequired } from "./lib/auth";
import { refreshOidcLogin } from "./lib/oidc";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { HomePage } from "./pages/HomePage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

function NotFoundRedirect(): JSX.Element {
  return <Navigate to="/" replace />;
}

export default function App(): JSX.Element {
  const [token, setToken] = useState<string | null>(() => getAuthToken());

  useEffect(() => {
    const syncToken = (): void => {
      setToken(getAuthToken());
    };

    window.addEventListener(AUTH_SESSION_CHANGED, syncToken);
    window.addEventListener("storage", syncToken);

    const expiresAt = getAuthExpiresAt();
    if (expiresAt && expiresAt <= Date.now()) {
      void refreshOidcLogin().then(syncToken);
    }

    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGED, syncToken);
      window.removeEventListener("storage", syncToken);
    };
  }, []);

  const onAuthed = (): void => {
    setToken(getAuthToken());
  };

  const onLogout = (): void => {
    clearAuthToken();
    markLoginPromptRequired();
    setToken(null);
  };

  return (
    <Routes>
      <Route path="/" element={<LandingPage isAuthenticated={Boolean(token)} onLogout={onLogout} />} />
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage onAuthenticated={onAuthed} />} />
      <Route path="/mind" element={token ? <HomePage onLogout={onLogout} /> : <Navigate to="/login" replace state={{ from: "/mind" }} />} />
      <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
      <Route path="/kanban" element={<PlaceholderPage title="Kanban" />} />
      <Route path="*" element={<NotFoundRedirect />} />
    </Routes>
  );
}
