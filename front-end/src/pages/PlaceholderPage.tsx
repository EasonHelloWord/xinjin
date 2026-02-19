import { Link } from "react-router-dom";

interface PlaceholderPageProps {
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
