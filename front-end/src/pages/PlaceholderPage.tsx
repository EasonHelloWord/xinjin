// 占位页：用于尚未实现的路由页面。
import { Link } from "react-router-dom";

interface PlaceholderPageProps {
  // 页面标题（例如 Dashboard / Kanban / Login）
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps): JSX.Element {
  return (
    <div className="placeholder-page">
      <h1>{title}</h1>
      <p>coming soon</p>
      <Link to="/" className="btn-link">
        返回首页
      </Link>
    </div>
  );
}
