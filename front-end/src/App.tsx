// 路由总入口：统一管理页面路径到组件的映射关系。
import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

export default function App(): JSX.Element {
  return (
    <Routes>
      {/* 首页：云团可视化主界面 */}
      <Route path="/" element={<HomePage />} />
      {/* 以下页面当前为占位页面，后续可替换为真实业务页面 */}
      <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
      <Route path="/kanban" element={<PlaceholderPage title="Kanban" />} />
      <Route path="/login" element={<PlaceholderPage title="Login" />} />
      {/* 未匹配到路径时，回到首页 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
