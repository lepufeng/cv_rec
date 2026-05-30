import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { endpoints, HttpError } from "@/lib/api";
import { ErrorBanner } from "@/components/UI";

type Props = { mode: "login" | "register" };

export default function UserAuth({ mode }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { applyAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp =
        mode === "login"
          ? await endpoints.loginUser(username.trim(), password)
          : await endpoints.registerUser(username.trim(), password);
      applyAuth(resp);
      const from = (location.state as { from?: Location })?.from;
      const redirect = from ? `${from.pathname}${from.search}` : "/plugin?autolink=1";
      navigate(redirect, { replace: true });
    } catch (err) {
      if (err instanceof HttpError) setError(err.payload.message);
      else setError(mode === "login" ? "登录失败" : "注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-ink-50 to-accent-light/30">
      <div className="card max-w-md w-full px-8 py-8">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-semibold">
              C
            </div>
            <span className="font-semibold tracking-tight">CV Rec</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight mt-5">
            {mode === "login" ? "用户登录" : "创建账号"}
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {mode === "login"
              ? "使用你的用户名和密码登录"
              : "注册即可开始上传与解析简历"}
          </p>
        </div>

        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3-64 字符"
              className="input"
              autoFocus
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="label">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className="input"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={loading || !username || !password}
          >
            {loading
              ? mode === "login"
                ? "登录中…"
                : "创建中…"
              : mode === "login"
                ? "登录"
                : "创建账号"}
          </button>
        </form>

        <div className="text-sm text-ink-500 mt-5 text-center space-y-1">
          {mode === "login" ? (
            <p>
              还没有账号？
              <Link to="/register" className="text-accent hover:underline ml-1">
                立即注册
              </Link>
            </p>
          ) : (
            <p>
              已有账号？
              <Link to="/login" className="text-accent hover:underline ml-1">
                直接登录
              </Link>
            </p>
          )}
          <p className="text-xs text-ink-500/80">
            管理员登录请前往
            <Link
              to="/admin/login"
              className="text-ink-700 hover:text-accent hover:underline ml-1"
            >
              管理员入口
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
