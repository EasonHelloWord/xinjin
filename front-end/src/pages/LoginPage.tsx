import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { startOidcLogin } from "../lib/oidc";

export function LoginPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = searchParams.get("mode") === "register" ? "register" : "login";
  const from = typeof location.state === "object" && location.state && "from" in location.state
    ? String(location.state.from || "/mind")
    : "/mind";

  const redirectToAuth = async (register = false): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      await startOidcLogin({ register, returnTo: from });
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{mode === "register" ? "注册统一身份账号" : "统一身份登录"}</h1>
        <p>将跳转到 auth.easonjan.top 完成身份认证，认证后自动回到心镜。</p>
        {error && <div className="auth-error">{error}</div>}
        <button type="button" onClick={() => redirectToAuth(mode === "register")} disabled={loading}>
          {loading ? "跳转中..." : mode === "register" ? "前往注册" : "前往登录"}
        </button>
        <button
          type="button"
          className="auth-switch"
          onClick={() => redirectToAuth(mode !== "register")}
          disabled={loading}
        >
          {mode === "register" ? "已有账号？前往登录" : "还没有账号？前往注册"}
        </button>
      </div>
    </div>
  );
}
