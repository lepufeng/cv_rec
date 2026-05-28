import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, ErrorBanner, PageHeader } from "@/components/UI";
import { ParseProgress, type ParsePhase } from "@/components/ParseProgress";
import { endpoints, HttpError, NetworkError } from "@/lib/api";

const ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg";
const MAX_MB = 10;

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<ParsePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const busy = phase === "uploading" || phase === "parsing";

  function chooseFile(f: File | null) {
    setError(null);
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    if (!["pdf", "docx", "png", "jpg", "jpeg"].includes(ext)) {
      setError(`不支持的格式：${ext}`);
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`文件超过 ${MAX_MB} MB 限制`);
      return;
    }
    setFile(f);
  }

  async function handleSubmit() {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    try {
      // The fetch starts uploading immediately; once the server begins parsing
      // we have no signal, so flip to "parsing" after the same tick. The
      // asymptotic curve carries from ~0% upward regardless of phase.
      requestAnimationFrame(() => setPhase("parsing"));
      const detail = await endpoints.uploadResume(file, {
        thinkingMode: thinkingEnabled ? "enabled" : "disabled",
      });
      setPhase("done");
      // Brief pause so the user sees the bar reach 100% before navigating.
      setTimeout(
        () => navigate(`/profile?rid=${detail.resume_id}`, { replace: true }),
        500,
      );
    } catch (err) {
      setPhase("failed");
      if (err instanceof HttpError || err instanceof NetworkError) setError(err.payload.message);
      else setError("上传失败");
    }
  }

  return (
    <div>
      <PageHeader
        title="上传简历"
        description="支持 PDF / DOCX / PNG / JPG，最大 10 MB。系统将自动解析为结构化数据。"
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <Card>
        <div
          onDragOver={(e) => {
            if (busy) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (busy) return;
            e.preventDefault();
            setDragOver(false);
            chooseFile(e.dataTransfer.files?.[0] || null);
          }}
          className={`border-2 border-dashed rounded-xl px-6 py-14 text-center transition-colors ${
            dragOver
              ? "border-accent bg-accent-light"
              : "border-ink-200 bg-ink-50"
          }`}
        >
          {file ? (
            <div className="space-y-3">
              <div className="text-4xl">📄</div>
              <div className="font-medium">{file.name}</div>
              <div className="text-sm text-ink-500">
                {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown"}
              </div>
              <div className="flex justify-center gap-2 pt-2">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setFile(null);
                    setPhase("idle");
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                  disabled={busy}
                >
                  重新选择
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSubmit}
                  disabled={busy || phase === "done"}
                >
                  {busy ? "处理中…" : phase === "done" ? "已完成" : "开始解析"}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-4xl mb-3">⬆️</div>
              <p className="text-sm text-ink-700">
                拖拽文件到此处，或
                <button
                  type="button"
                  className="text-accent font-medium mx-1 hover:underline"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  点击选择
                </button>
              </p>
              <p className="text-xs text-ink-500 mt-2">支持 {ACCEPT}</p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => chooseFile(e.target.files?.[0] || null)}
              />
            </div>
          )}
        </div>

        <label className="mt-5 flex items-start gap-3 rounded-lg border border-ink-200 bg-white px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-accent"
            checked={thinkingEnabled}
            disabled={busy}
            onChange={(e) => setThinkingEnabled(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-ink-900">
              增强推理模式
            </span>
            <span className="mt-1 block text-xs leading-5 text-ink-500">
              适合排版复杂或字段模糊的简历；通常更慢，计费也可能更高。
            </span>
          </span>
        </label>

        {phase !== "idle" && (
          <div className="mt-6">
            <ParseProgress phase={phase} />
          </div>
        )}
      </Card>

      <div className="mt-6 text-xs text-ink-500">
        提示：解析结果会保留原始字段，缺失字段标记为空。后续在简历预览页可手动修正。
      </div>
    </div>
  );
}
