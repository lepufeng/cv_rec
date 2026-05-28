/**
 * Asymptotic progress bar for synchronous parse calls.
 *
 * The backend doesn't expose real-time progress (the model is invoked as a
 * single blocking HTTP call), so we drive an asymptotic curve based on the
 * observed median latency. The bar approaches 95% but never reaches it on
 * its own — only the "done" phase pushes it to 100%.
 *
 *   pct(t) = 95 * (1 - exp(-t / TAU))
 *     TAU = 30s  →  30s≈63%, 60s≈86%, 90s≈95%
 */
import { useEffect, useRef, useState } from "react";

export type ParsePhase = "idle" | "uploading" | "parsing" | "done" | "failed";

const TAU_SECONDS = 30;
const ASYMPTOTE = 95;

const PHASE_LABEL: Record<ParsePhase, string> = {
  idle: "",
  uploading: "上传文件",
  parsing: "AI 解析中",
  done: "解析完成",
  failed: "解析失败",
};

export function ParseProgress({
  phase,
  hint = "通常 30-60 秒，复杂简历可能更长，请勿关闭页面",
}: {
  phase: ParsePhase;
  hint?: string;
}) {
  const [pct, setPct] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase === "idle") {
      setPct(0);
      setElapsed(0);
      startRef.current = null;
      return;
    }
    if (phase === "done") {
      setPct(100);
      return;
    }
    if (phase === "failed") {
      return;
    }

    // uploading or parsing — animate.
    if (startRef.current == null) startRef.current = Date.now();

    const tick = () => {
      const t = (Date.now() - (startRef.current ?? Date.now())) / 1000;
      setElapsed(t);
      setPct(ASYMPTOTE * (1 - Math.exp(-t / TAU_SECONDS)));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [phase]);

  if (phase === "idle") return null;

  const barColor =
    phase === "failed"
      ? "bg-red-400"
      : phase === "done"
        ? "bg-emerald-500"
        : "bg-accent";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink-700">
          {PHASE_LABEL[phase]}
          {(phase === "uploading" || phase === "parsing") && "…"}
        </span>
        <span className="font-mono text-xs text-ink-500">
          {phase === "done" ? "100%" : `${Math.round(pct)}%`}
          {(phase === "uploading" || phase === "parsing") && elapsed > 0 &&
            ` · ${Math.round(elapsed)}s`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
        <div
          className={`h-full transition-[width] duration-300 ease-out ${barColor}`}
          style={{ width: `${phase === "done" ? 100 : pct}%` }}
        />
      </div>
      {hint && (phase === "uploading" || phase === "parsing") && (
        <p className="text-xs text-ink-500">{hint}</p>
      )}
    </div>
  );
}
