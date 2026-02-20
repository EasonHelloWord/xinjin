import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import { setAuthToken } from "../lib/auth";

interface LoginPageProps {
  onAuthenticated: () => void;
}

type AuthMode = "login" | "register";

export function LoginPage({ onAuthenticated }: LoginPageProps): JSX.Element {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response =
        mode === "login" ? await api.login(email.trim(), password) : await api.register(email.trim(), password);
      setAuthToken(response.token);
      onAuthenticated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>{mode === "login" ? "登录" : "注册"}</h1>
        <p>登录后即可开始流式对话与语音播报。</p>
        <label>
          邮箱
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="请输入邮箱"
          />
        </label>
        <label>
          密码
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 8 位密码"
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "提交中..." : mode === "login" ? "登录" : "注册"}
        </button>
        <button
          type="button"
          className="auth-switch"
          onClick={() => setMode((prev) => (prev === "login" ? "register" : "login"))}
          disabled={loading}
        >
          {mode === "login" ? "还没有账号？去注册" : "已有账号？去登录"}
        </button>
      </form>
    </div>
  );
}
