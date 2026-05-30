import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, EmptyState, ErrorBanner, PageHeader, StatusPill } from "@/components/UI";
import { endpoints, getToken, HttpError, type ResumeDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type CopyKey = "portal" | "backend" | "token" | `resume:${string}`;
type BridgeStatus = {
  connected: boolean;
  hasResume: boolean;
  platformHome: string;
  backendBase: string;
  resumeId: string;
  linkedAt?: string;
  linkedUsername?: string;
};
type BridgeState = {
  checked: boolean;
  available: boolean;
  connecting: boolean;
  message: string;
  status: BridgeStatus | null;
};
type BridgeResponse = {
  source?: string;
  type?: string;
  requestId?: string;
  ok?: boolean;
  error?: string;
  status?: BridgeStatus;
};

const PLATFORM_BRIDGE_SOURCE = "cv-rec-platform";
const EXTENSION_BRIDGE_SOURCE = "cv-rec-extension";
const STATUS_REQUEST = "CV_REC_PLUGIN_STATUS";
const STATUS_RESULT = "CV_REC_PLUGIN_STATUS_RESULT";
const CONNECT_REQUEST = "CV_REC_CONNECT_PLUGIN";
const CONNECT_RESULT = "CV_REC_CONNECT_PLUGIN_RESULT";
const MAX_BRIDGE_ATTEMPTS = 3;
const STATUS_TIMEOUT_MS = 1400;
const CONNECT_TIMEOUT_MS = 1600;

function localBackendBase() {
  const host = window.location.hostname;
  if ((host === "localhost" || host === "127.0.0.1") && window.location.port === "5173") {
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
  const [bridge, setBridge] = useState<BridgeState>({
    checked: false,
    available: false,
    connecting: false,
    message: "正在检测浏览器插件...",
    status: null,
  });
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user);
  const token = getToken("user");
  const portalUrl = useMemo(() => window.location.origin, []);
  const backendBase = useMemo(localBackendBase, []);
  const selectedResumeId = params.get("rid");
  const autoLink = params.get("autolink") === "1";
  const pendingStatusId = useRef("");
  const pendingConnectId = useRef("");
  const statusTimer = useRef<number | null>(null);
  const connectTimer = useRef<number | null>(null);
  const autoLinkAttempted = useRef(false);
  const orderedResumes = useMemo(() => {
    if (!resumes || !selectedResumeId) return resumes;
    return [...resumes].sort((a, b) => {
      if (a.resume_id === selectedResumeId) return -1;
      if (b.resume_id === selectedResumeId) return 1;
      return 0;
    });
  }, [resumes, selectedResumeId]);
  const recommendedResume = useMemo(() => {
    if (!resumes || resumes.length === 0) return null;
    return (
      resumes.find((resume) => resume.resume_id === selectedResumeId) ||
      resumes.find((resume) => resume.status === "completed") ||
      resumes[0]
    );
  }, [resumes, selectedResumeId]);

  const postBridgeMessage = useCallback((type: string, requestId: string, payload?: unknown) => {
    window.postMessage(
      {
        source: PLATFORM_BRIDGE_SOURCE,
        type,
        requestId,
        payload,
      },
      window.location.origin,
    );
  }, []);

  const requestPluginStatus = useCallback((attempt = 0) => {
    const requestId = bridgeRequestId();
    pendingStatusId.current = requestId;
    setBridge((current) => ({
      ...current,
      checked: false,
      message: attempt === 0 ? "正在检测浏览器插件..." : "正在重新检测浏览器插件...",
    }));
    postBridgeMessage(STATUS_REQUEST, requestId);
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => {
      if (pendingStatusId.current !== requestId) return;
      pendingStatusId.current = "";
      if (attempt + 1 < MAX_BRIDGE_ATTEMPTS) {
        requestPluginStatus(attempt + 1);
        return;
      }
      setBridge({
        checked: true,
        available: false,
        connecting: false,
        message: "未检测到插件，请确认已在 Chrome 扩展管理页加载插件。",
        status: null,
      });
    }, STATUS_TIMEOUT_MS);
  }, [postBridgeMessage]);

  const connectPlugin = useCallback((manual: boolean, attempt = 0) => {
    if (!token) {
      setBridge((current) => ({
        ...current,
        checked: true,
        available: current.available,
        connecting: false,
        message: "当前未找到网页登录 token，请重新登录。",
      }));
      return;
    }

    const requestId = bridgeRequestId();
    pendingConnectId.current = requestId;
    setBridge((current) => ({
      ...current,
      checked: true,
      connecting: true,
      message: attempt === 0
        ? manual
          ? "正在连接插件..."
          : "网页登录已完成，正在自动连接插件..."
        : manual
          ? "正在重新连接插件..."
          : "正在重新自动连接插件...",
    }));
    postBridgeMessage(CONNECT_REQUEST, requestId, {
      platformHome: portalUrl,
      backendBase,
      authToken: token,
      resumeId: recommendedResume?.resume_id || "",
      username: user?.username || "",
    });

    if (connectTimer.current) window.clearTimeout(connectTimer.current);
    connectTimer.current = window.setTimeout(() => {
      if (pendingConnectId.current !== requestId) return;
      pendingConnectId.current = "";
      if (attempt + 1 < MAX_BRIDGE_ATTEMPTS) {
        connectPlugin(manual, attempt + 1);
        return;
      }
      setBridge((current) => ({
        ...current,
        checked: true,
        available: false,
        connecting: false,
        message: "插件没有响应，请刷新本页或重新加载 Chrome 插件后重试。",
      }));
    }, CONNECT_TIMEOUT_MS);
  }, [backendBase, postBridgeMessage, portalUrl, recommendedResume?.resume_id, token, user?.username]);

  useEffect(() => {
    endpoints
      .listResumes()
      .then(setResumes)
      .catch((err) => {
        setError(err instanceof HttpError ? err.payload.message : "加载简历失败");
        setResumes([]);
      });
  }, []);

  useEffect(() => {
    function handleBridgeResponse(event: MessageEvent<BridgeResponse>) {
      if (event.source !== window) return;
      const message = event.data || {};
      if (message.source !== EXTENSION_BRIDGE_SOURCE) return;

      if (message.type === STATUS_RESULT && message.requestId === pendingStatusId.current) {
        pendingStatusId.current = "";
        if (statusTimer.current) window.clearTimeout(statusTimer.current);
        setBridge({
          checked: true,
          available: !!message.ok,
          connecting: false,
          message: message.ok
            ? bridgeStatusText(message.status || null)
            : message.error || "插件状态读取失败",
          status: message.status || null,
        });
      }

      if (message.type === CONNECT_RESULT && message.requestId === pendingConnectId.current) {
        pendingConnectId.current = "";
        if (connectTimer.current) window.clearTimeout(connectTimer.current);
        setBridge({
          checked: true,
          available: !!message.ok,
          connecting: false,
          message: message.ok
            ? bridgeStatusText(message.status || null)
            : message.error || "插件连接失败",
          status: message.status || null,
        });
      }
    }

    window.addEventListener("message", handleBridgeResponse);
    requestPluginStatus();
    return () => {
      window.removeEventListener("message", handleBridgeResponse);
      if (statusTimer.current) window.clearTimeout(statusTimer.current);
      if (connectTimer.current) window.clearTimeout(connectTimer.current);
    };
  }, [requestPluginStatus]);

  useEffect(() => {
    if (!autoLink || autoLinkAttempted.current || resumes === null) return;
    autoLinkAttempted.current = true;
    connectPlugin(false);
  }, [autoLink, connectPlugin, resumes]);

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
          <Card title="自动连接插件" description="登录后会把账户凭证写入本机 Chrome 插件。">
            <div className="flex items-center justify-between gap-3 rounded-md border border-ink-200 bg-ink-50 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink-900">
                  {bridge.available ? "已检测到插件" : bridge.checked ? "未检测到插件" : "检测中"}
                </div>
                <div className="mt-1 text-xs leading-5 text-ink-500">{bridge.message}</div>
              </div>
              <span
                className={
                  bridge.available && bridge.status?.connected
                    ? "pill-success"
                    : bridge.available
                      ? "pill-muted"
                      : "pill-error"
                }
              >
                {bridge.available && bridge.status?.connected
                  ? bridge.status.hasResume
                    ? "已连接"
                    : "待选简历"
                  : bridge.available
                    ? "可连接"
                    : "未连接"}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="btn-primary"
                onClick={() => connectPlugin(true)}
                disabled={bridge.connecting || !token}
              >
                {bridge.connecting ? "连接中..." : "连接到插件"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => requestPluginStatus()}>
                重新检测
              </button>
            </div>

            <div className="mt-4 rounded-md border border-ink-100 px-3 py-2 text-xs leading-5 text-ink-600">
              推荐简历：
              {recommendedResume ? (
                <span className="ml-1 font-mono text-ink-800">
                  {recommendedResume.resume_id.slice(0, 8)}
                </span>
              ) : (
                <span className="ml-1 text-ink-500">暂无，上传后会自动带入</span>
              )}
            </div>
          </Card>

          <Card title="手动连接参数" description="自动连接不可用时，可复制到插件弹窗。">
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
              <li>3. 回到本页点击连接到插件。</li>
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

function bridgeRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function bridgeStatusText(status: BridgeStatus | null) {
  if (!status || !status.connected) return "插件已安装，尚未连接当前网页账户。";
  if (!status.hasResume) return "网页账户已同步，上传或选择简历后可再次连接。";
  return `插件已连接，当前简历 ${status.resumeId.slice(0, 8)}。`;
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
