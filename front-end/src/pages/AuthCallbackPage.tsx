import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { finishOidcLogin } from "../lib/oidc";

interface AuthCallbackPageProps {
  onAuthenticated: () => void;
}

export function AuthCallbackPage({ onAuthenticated }: AuthCallbackPageProps): JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code || !state) {
      setError("认证回调缺少 code 或 state。");
      return;
    }

    finishOidcLogin(code, state)
      .then((returnTo) => {
        onAuthenticated();
        navigate(returnTo, { replace: true });
      })
      .catch((err) => {
        setError((err as Error).message);
      });
  }, [navigate, onAuthenticated, searchParams]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>正在完成登录</h1>
        <p>请稍候，正在校验统一身份认证结果。</p>
        {error && <div className="auth-error">{error}</div>}
        {error && (
          <button type="button" onClick={() => navigate("/login", { replace: true })}>
            重新登录
          </button>
        )}
      </div>
    </div>
  );
}
