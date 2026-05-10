import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { clearAuthToken, getAuthToken } from "./lib/auth";
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

  const onAuthed = (): void => {
    setToken(getAuthToken());
  };

  const onLogout = (): void => {
    clearAuthToken();
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
