import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { endpoints, HttpError } from "@/lib/api";
import { ErrorBanner } from "@/components/UI";

export default function AdminAuth() {
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { applyAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    endpoints
      .adminBootstrapStatus()
      .then((r) => setNeedsBootstrap(r.needs_bootstrap))
      .catch(() => setNeedsBootstrap(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsBootstrap && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    try {
      const resp = needsBootstrap
        ? await endpoints.bootstrapAdmin(username.trim(), password)
        : await endpoints.loginAdmin(username.trim(), password);
      applyAuth(resp);
      navigate("/admin/stats", { replace: true });
    } catch (err) {
      if (err instanceof HttpError) setError(err.payload.message);
      else setError("操作失败");
    } finally {
      setLoading(false);
    }
  }

  if (needsBootstrap === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-ink-500">
        加载中…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-ink-900">
      <div className="card max-w-md w-full px-8 py-8 bg-white">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-ink-900 text-white flex items-center justify-center font-semibold">
              A
            </div>
            <span className="font-semibold tracking-tight">CV Rec · Admin</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight mt-5">
            {needsBootstrap ? "初始化管理员" : "管理员登录"}
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {needsBootstrap
              ? "尚未创建任何管理员，请设置初始账号"
              : "仅限管理员账户访问"}
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
              placeholder={needsBootstrap ? "3-64 字符" : "管理员用户名"}
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
              placeholder={needsBootstrap ? "至少 6 位" : "管理员密码"}
              className="input"
              autoComplete={needsBootstrap ? "new-password" : "current-password"}
              required
            />
          </div>
          {needsBootstrap && (
            <div>
              <label className="label">确认密码</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input"
                autoComplete="new-password"
                required
              />
            </div>
          )}
          <button
            type="submit"
            className="btn-primary w-full !bg-ink-900 hover:!bg-ink-700"
            disabled={loading || !username || !password}
          >
            {loading
              ? needsBootstrap
                ? "创建中…"
                : "登录中…"
              : needsBootstrap
                ? "创建管理员账号"
                : "登录"}
          </button>
        </form>

        <div className="text-sm text-ink-500 mt-5 text-center">
          <Link to="/login" className="text-ink-700 hover:text-accent hover:underline">
            ← 返回普通用户入口
          </Link>
        </div>
      </div>
    </div>
  );
}
