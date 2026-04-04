import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { clearAuthToken, getAuthToken } from "./lib/auth";
import { HomePage } from "./pages/HomePage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

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
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage onAuthenticated={onAuthed} />} />
      <Route path="/mind" element={token ? <HomePage onLogout={onLogout} /> : <Navigate to="/login" replace />} />
      <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
      <Route path="/kanban" element={<PlaceholderPage title="Kanban" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
