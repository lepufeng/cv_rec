import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, EmptyState, ErrorBanner, PageHeader, StatusPill } from "@/components/UI";
import { endpoints, getToken, HttpError, type ResumeDetail } from "@/lib/api";

type CopyKey = "portal" | "backend" | "token" | `resume:${string}`;

function localBackendBase() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://127.0.0.1:8000/api/v1";
  }
  return `${window.location.origin}/api/v1`;
}

function shortToken(token: string | null) {
  if (!token) return "当前未找到登录 token";
  if (token.length <= 24) return token;
  return `${token.slice(0, 12)}...${token.slice(-8)}`;
}

export default function PluginConnect() {
  const [resumes, setResumes] = useState<ResumeDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyKey | null>(null);
  const [params] = useSearchParams();
  const token = getToken("user");
  const portalUrl = useMemo(() => window.location.origin, []);
  const backendBase = useMemo(localBackendBase, []);
  const selectedResumeId = params.get("rid");
  const orderedResumes = useMemo(() => {
    if (!resumes || !selectedResumeId) return resumes;
    return [...resumes].sort((a, b) => {
      if (a.resume_id === selectedResumeId) return -1;
      if (b.resume_id === selectedResumeId) return 1;
      return 0;
    });
  }, [resumes, selectedResumeId]);

  useEffect(() => {
    endpoints
      .listResumes()
      .then(setResumes)
      .catch((err) => {
        setError(err instanceof HttpError ? err.payload.message : "加载简历失败");
        setResumes([]);
      });
  }, []);

  async function copy(value: string, key: CopyKey) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1200);
  }

  return (
    <div>
      <PageHeader
        title="连接插件"
        description="把网页账户与浏览器插件关联后，可在小鹏及飞书招聘系页面执行自动填写。"
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 lg:col-span-5 space-y-6">
          <Card title="插件连接参数" description="在插件弹窗中保存这三项配置。">
            <CopyRow
              label="平台首页"
              value={portalUrl}
              copied={copied === "portal"}
              onCopy={() => copy(portalUrl, "portal")}
            />
            <CopyRow
              label="后端 API"
              value={backendBase}
              copied={copied === "backend"}
              onCopy={() => copy(backendBase, "backend")}
            />
            <CopyRow
              label="登录 token"
              value={shortToken(token)}
              copied={copied === "token"}
              onCopy={() => token && copy(token, "token")}
              disabled={!token}
            />
          </Card>

          <Card title="当前流程">
            <ol className="space-y-3 text-sm text-ink-700">
              <li>1. 注册或登录网页账户。</li>
              <li>2. 上传简历并等待解析完成。</li>
              <li>3. 在插件中保存 API、token 与简历 ID。</li>
              <li>4. 打开小鹏或飞书招聘系填写页，点击插件开始自动填写。</li>
            </ol>
          </Card>
        </section>

        <section className="col-span-12 lg:col-span-7">
          <Card title="可用于插件的简历 ID" padded={false}>
            {resumes === null ? (
              <div className="px-6 py-8 text-sm text-ink-500">加载中...</div>
            ) : resumes.length === 0 ? (
              <EmptyState
                title="还没有简历"
                description="先上传并解析一份简历，再把简历 ID 填入插件。"
                action={
                  <Link to="/upload" className="btn-primary">
                    上传简历
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {(orderedResumes || []).map((resume) => {
                  const key: CopyKey = `resume:${resume.resume_id}`;
                  const selected = resume.resume_id === selectedResumeId;
                  return (
                    <li
                      key={resume.resume_id}
                      className={`px-6 py-4 ${selected ? "bg-accent-light/40" : ""}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-ink-900">
                              简历 {resume.resume_id.slice(0, 8)}
                            </span>
                            <StatusPill status={resume.status} />
                            {selected && <span className="pill-muted">当前选择</span>}
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-ink-500">
                            {resume.resume_id}
                          </div>
                        </div>
                        <button
                          className="btn-secondary shrink-0 !py-1.5 !px-3"
                          onClick={() => copy(resume.resume_id, key)}
                        >
                          {copied === key ? "已复制" : selected ? "复制推荐 ID" : "复制 ID"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copied,
  disabled,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  disabled?: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="border-b border-ink-100 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="label !mb-0">{label}</span>
        <button
          type="button"
          className="btn-secondary !py-1 !px-2 !text-xs"
          onClick={onCopy}
          disabled={disabled}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <div className="min-h-10 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs leading-5 text-ink-700 break-all">
        {value}
      </div>
    </div>
  );
}
