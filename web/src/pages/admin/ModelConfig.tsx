import { useEffect, useState } from "react";
import { Card, ErrorBanner, PageHeader } from "@/components/UI";
import {
  endpoints,
  HttpError,
  type ModelConfig,
  type ModelTestResponse,
} from "@/lib/api";

const PROVIDERS: ModelConfig["provider"][] = ["glm", "qwen"];
const NETWORK_MODES: ModelConfig["model_network_mode"][] = ["direct", "environment", "proxy"];

export default function AdminModelConfig() {
  const [cfg, setCfg] = useState<ModelConfig | null>(null);
  const [draft, setDraft] = useState<Partial<ModelConfig>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ModelTestResponse | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const data = await endpoints.getModelConfig();
      setCfg(data);
      setDraft({});
    } catch (e) {
      if (e instanceof HttpError) setError(e.payload.message);
    }
  }

  function update<K extends keyof ModelConfig>(k: K, v: ModelConfig[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Drop masked secrets so we don't overwrite real values with stars
      const cleanedDraft = { ...draft };
      if (cleanedDraft.glm_api_key?.includes("****")) delete cleanedDraft.glm_api_key;
      if (cleanedDraft.qwen_api_key?.includes("****")) delete cleanedDraft.qwen_api_key;
      const updated = await endpoints.patchModelConfig(cleanedDraft);
      setCfg(updated);
      setDraft({});
      setTestResult(null);
    } catch (e) {
      if (e instanceof HttpError) setError(e.payload.message);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await endpoints.testModelConfig();
      setTestResult(r);
    } catch (e) {
      if (e instanceof HttpError) setError(e.payload.message);
    } finally {
      setTesting(false);
    }
  }

  if (!cfg) return <div className="text-sm text-ink-500">加载中…</div>;

  const merged: ModelConfig = { ...cfg, ...draft };
  const dirty = Object.keys(draft).length > 0;

  return (
    <div>
      <PageHeader
        title="模型配置"
        description="设置解析、填写与推理模型。推理模型用于后续 facts 审阅、schema 判断等更重的语义任务。"
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-6">
        <Card title="模型服务选择" description="决定阶段 A / 阶段 B 与推理模型共用的模型组和 API Key">
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                onClick={() => update("provider", p)}
                className={`btn ${
                  merged.provider === p
                    ? "bg-accent text-white"
                    : "btn-secondary"
                }`}
              >
                {PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>
        </Card>

        <Card
          title="Thinking 默认策略"
          description="用户上传或插件请求未指定时使用该策略；开启后可能提升复杂判断质量，但延迟和费用通常更高"
        >
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-accent"
              checked={merged.model_thinking_mode === "enabled"}
              onChange={(e) =>
                update("model_thinking_mode", e.target.checked ? "enabled" : "disabled")
              }
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">
                默认开启 Thinking
              </span>
              <span className="mt-1 block text-xs leading-5 text-ink-500">
                关闭时会对支持的 GLM 模型传入 thinking disabled；用户仍可在上传时单次开启。
              </span>
            </span>
          </label>
        </Card>

        <Card
          title="模型网络"
          description="仅影响后端访问 GLM/Qwen；不影响浏览器访问招聘网站或插件连接本地后端"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {NETWORK_MODES.map((mode) => (
                <button
                  key={mode}
                  onClick={() => update("model_network_mode", mode)}
                  className={`btn ${
                    merged.model_network_mode === mode
                      ? "bg-accent text-white"
                      : "btn-secondary"
                  }`}
                >
                  {NETWORK_MODE_LABEL[mode]}
                </button>
              ))}
            </div>
            <p className="text-xs leading-5 text-ink-500">
              直连会忽略 HTTP_PROXY / HTTPS_PROXY 等环境代理；指定代理只给模型请求使用。
            </p>
            {merged.model_network_mode === "proxy" && (
              <Field label="模型代理 URL" placeholder="例如 http://127.0.0.1:7890">
                <input
                  className="input"
                  value={merged.model_proxy_url || ""}
                  onChange={(e) => update("model_proxy_url", e.target.value)}
                  placeholder="http://127.0.0.1:7890"
                />
              </Field>
            )}
          </div>
        </Card>

        <Card
          title="主力模型"
          description="当前默认模型组。OCR 模型处理 PDF/图片；视觉模型处理 DOCX/兜底；对话模型负责表单填写"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="API Key" placeholder="未配置">
              <input
                type="password"
                className="input font-mono"
                value={merged.glm_api_key || ""}
                onChange={(e) => update("glm_api_key", e.target.value)}
                placeholder="zhipu-..."
              />
            </Field>
            <Field label="Base URL">
              <input
                className="input"
                value={merged.glm_base_url || ""}
                onChange={(e) => update("glm_base_url", e.target.value)}
              />
            </Field>
            <Field label="OCR 模型 (PDF / 图片)">
              <input
                className="input"
                value={merged.glm_ocr_model || ""}
                onChange={(e) => update("glm_ocr_model", e.target.value)}
                placeholder="glm-ocr"
              />
            </Field>
            <Field label="视觉模型 (DOCX / 兜底)">
              <input
                className="input"
                value={merged.glm_vision_model || ""}
                onChange={(e) => update("glm_vision_model", e.target.value)}
              />
            </Field>
            <Field label="对话模型 (阶段 B)">
              <input
                className="input"
                value={merged.glm_chat_model || ""}
                onChange={(e) => update("glm_chat_model", e.target.value)}
              />
            </Field>
            <Field label="推理模型 (facts / schema judge)" placeholder="为空时回退到对话模型">
              <input
                className="input"
                value={merged.glm_reasoning_model || ""}
                onChange={(e) => update("glm_reasoning_model", e.target.value)}
                placeholder={merged.glm_chat_model || "与对话模型相同"}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="备用模型"
          description="备用模型组，可在主力模型不可用或需要切换成本/效果时使用"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="API Key">
              <input
                type="password"
                className="input font-mono"
                value={merged.qwen_api_key || ""}
                onChange={(e) => update("qwen_api_key", e.target.value)}
                placeholder="sk-..."
              />
            </Field>
            <Field label="Base URL">
              <input
                className="input"
                value={merged.qwen_base_url || ""}
                onChange={(e) => update("qwen_base_url", e.target.value)}
              />
            </Field>
            <Field label="OCR 模型 (PDF / 图片)" placeholder="为空时不启用 OCR，直接走视觉模型">
              <input
                className="input"
                value={merged.qwen_ocr_model || ""}
                onChange={(e) => update("qwen_ocr_model", e.target.value)}
                placeholder="未配置"
              />
            </Field>
            <Field label="视觉模型 (DOCX / 兜底)">
              <input
                className="input"
                value={merged.qwen_vision_model || ""}
                onChange={(e) => update("qwen_vision_model", e.target.value)}
              />
            </Field>
            <Field label="对话模型">
              <input
                className="input"
                value={merged.qwen_chat_model || ""}
                onChange={(e) => update("qwen_chat_model", e.target.value)}
              />
            </Field>
            <Field label="推理模型 (facts / schema judge)" placeholder="为空时回退到对话模型">
              <input
                className="input"
                value={merged.qwen_reasoning_model || ""}
                onChange={(e) => update("qwen_reasoning_model", e.target.value)}
                placeholder={merged.qwen_chat_model || "与对话模型相同"}
              />
            </Field>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? "保存中…" : dirty ? "保存修改" : "无未保存修改"}
          </button>
          <button
            className="btn-secondary"
            disabled={testing}
            onClick={runTest}
          >
            {testing ? "测试中…" : "连通性测试"}
          </button>
          {dirty && (
            <button className="btn-secondary" onClick={() => setDraft({})}>
              撤销
            </button>
          )}
        </div>

        {testResult && (
          <Card
            title="测试结果"
            action={
              <span
                className={
                  testResult.ok ? "pill-success" : "pill-error"
                }
              >
                {testResult.ok ? "成功" : "失败"}
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field label="模型组">
                <code className="text-ink-700">
                  {providerDisplayName(testResult.provider)}
                </code>
              </Field>
              <Field label="网络模式">
                <code className="text-ink-700">
                  {networkModeDisplayName(testResult.model_network_mode)}
                </code>
              </Field>
              <Field label="对话模型">
                <code className="text-ink-700">{testResult.chat_model}</code>
              </Field>
              <Field label="推理模型">
                <code className="text-ink-700">{testResult.reasoning_model || "未配置"}</code>
              </Field>
              <Field label="延迟">
                <code className="text-ink-700">
                  {testResult.latency_ms} ms
                </code>
              </Field>
              <Field label="状态">
                <code className="text-ink-700">
                  {testResult.ok ? "OK" : testResult.error}
                </code>
              </Field>
            </div>
            {testResult.sample && (
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">
                  返回样本
                </div>
                <pre className="bg-ink-100 rounded-lg p-3 text-xs whitespace-pre-wrap break-all">
                  {testResult.sample}
                </pre>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

const PROVIDER_LABEL: Record<ModelConfig["provider"], string> = {
  glm: "主力模型",
  qwen: "备用模型",
};

const NETWORK_MODE_LABEL: Record<ModelConfig["model_network_mode"], string> = {
  direct: "直连",
  environment: "环境代理",
  proxy: "指定代理",
};

function providerDisplayName(provider: string) {
  if (provider === "glm" || provider === "qwen") {
    return PROVIDER_LABEL[provider];
  }
  return provider;
}

function networkModeDisplayName(mode: string) {
  if (mode === "direct" || mode === "environment" || mode === "proxy") {
    return NETWORK_MODE_LABEL[mode];
  }
  return mode;
}

function Field({
  label,
  placeholder,
  children,
}: {
  label: string;
  placeholder?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {placeholder && (
        <p className="text-xs text-ink-500 mt-1">{placeholder}</p>
      )}
    </div>
  );
}
