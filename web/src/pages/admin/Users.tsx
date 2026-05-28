import { useEffect, useState } from "react";
import { Card, ErrorBanner, PageHeader } from "@/components/UI";
import { endpoints, HttpError, type AdminUserItem } from "@/lib/api";

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUserItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    endpoints.listAdminUsers()
      .then((r) => setUsers(r.users))
      .catch((e: HttpError) => setError(e.payload?.message || "加载失败"));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!users) return <div className="text-sm text-ink-500">加载中…</div>;

  return (
    <div>
      <PageHeader
        title="用户管理"
        description={`平台共 ${users.length} 位用户`}
      />

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="text-left px-6 py-3">用户名</th>
                <th className="text-left px-6 py-3">角色</th>
                <th className="text-left px-6 py-3">套餐</th>
                <th className="text-right px-6 py-3">简历数</th>
                <th className="text-right px-6 py-3">累计成本 (元)</th>
                <th className="text-left px-6 py-3">注册时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {users.map((u) => (
                <tr key={u.user_id} className="hover:bg-ink-50">
                  <td className="px-6 py-3">
                    <div className="font-medium">{u.username}</div>
                    <div className="text-xs text-ink-500 font-mono">
                      {u.user_id.slice(0, 8)}
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    {u.is_admin ? (
                      <span className="pill-success">管理员</span>
                    ) : (
                      <span className="pill-muted">用户</span>
                    )}
                  </td>
                  <td className="px-6 py-3">{u.plan_tier}</td>
                  <td className="px-6 py-3 text-right font-mono">
                    {u.resume_count}
                  </td>
                  <td className="px-6 py-3 text-right font-mono">
                    {Number(u.total_cost_cny).toFixed(4)}
                  </td>
                  <td className="px-6 py-3 text-ink-500">
                    {new Date(u.created_at).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
