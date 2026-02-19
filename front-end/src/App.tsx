import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
      <Route path="/kanban" element={<PlaceholderPage title="Kanban" />} />
      <Route path="/login" element={<PlaceholderPage title="Login" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
