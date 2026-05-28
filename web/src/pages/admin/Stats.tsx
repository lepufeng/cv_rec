import { useEffect, useState } from "react";
import { Card, ErrorBanner, PageHeader } from "@/components/UI";
import { endpoints, HttpError, type StatsResponse } from "@/lib/api";

export default function AdminStats() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    endpoints.adminStats()
      .then(setData)
      .catch((e: HttpError) => setError(e.payload?.message || "加载失败"));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <div className="text-sm text-ink-500">加载中…</div>;

  return (
    <div>
      <PageHeader
        title="平台总览"
        description="实时统计：用户数、解析量、token 消耗与成本明细"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="用户数" value={data.total_users} />
        <Stat label="简历总数" value={data.total_resumes} />
        <Stat label="模型调用次数" value={data.total_calls} />
        <Stat label="累计成本 (元)" value={Number(data.total_cost_cny).toFixed(4)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="按阶段">
          {Object.keys(data.by_stage).length === 0 ? (
            <p className="text-sm text-ink-500">暂无数据</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-500 uppercase">
                <tr>
                  <th className="text-left py-2">阶段</th>
                  <th className="text-right py-2">调用次数</th>
                  <th className="text-right py-2">成本 (元)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.by_stage).map(([stage, v]) => (
                  <tr key={stage} className="border-t border-ink-100">
                    <td className="py-2">{STAGE_LABEL[stage] || stage}</td>
                    <td className="py-2 text-right font-mono">{v.calls}</td>
                    <td className="py-2 text-right font-mono">
                      {Number(v.cost_cny).toFixed(6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="按模型">
          {Object.keys(data.by_model).length === 0 ? (
            <p className="text-sm text-ink-500">暂无数据</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-500 uppercase">
                <tr>
                  <th className="text-left py-2">模型</th>
                  <th className="text-right py-2">调用次数</th>
                  <th className="text-right py-2">成本 (元)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.by_model).map(([model, v]) => (
                  <tr key={model} className="border-t border-ink-100">
                    <td className="py-2 font-mono text-xs">{model}</td>
                    <td className="py-2 text-right font-mono">{v.calls}</td>
                    <td className="py-2 text-right font-mono">
                      {Number(v.cost_cny).toFixed(6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Token 消耗">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="输入" value={data.total_input_tokens.toLocaleString()} />
            <Stat label="输出" value={data.total_output_tokens.toLocaleString()} />
          </div>
        </Card>
      </div>
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  parsing: "阶段 A · 解析",
  filling: "阶段 B · 填写",
};

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="text-2xl font-semibold mt-1 font-mono">{value}</div>
    </div>
  );
}
