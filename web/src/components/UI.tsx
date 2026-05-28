import { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-ink-500 mt-1">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  padded = true,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="card">
      {(title || description || action) && (
        <header className="flex items-start justify-between px-6 py-4 border-b border-ink-200/60">
          <div>
            {title && <h2 className="font-semibold text-ink-900">{title}</h2>}
            {description && (
              <p className="text-xs text-ink-500 mt-0.5">{description}</p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? "px-6 py-5" : ""}>{children}</div>
    </section>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "pill-success",
    processing: "pill-warn",
    pending: "pill-warn",
    failed: "pill-error",
  };
  const cls = map[status] || "pill-muted";
  const label: Record<string, string> = {
    completed: "已完成",
    processing: "解析中",
    pending: "等待中",
    failed: "失败",
  };
  return <span className={cls}>{label[status] || status}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-16">
      <h3 className="text-base font-medium text-ink-900">{title}</h3>
      {description && (
        <p className="text-sm text-ink-500 mt-1">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-700 hover:text-red-900 ml-3"
          aria-label="dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function FieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-ink-100 last:border-b-0">
      <div className="text-xs uppercase tracking-wide text-ink-500 self-center">
        {label}
      </div>
      <div className="col-span-2 text-sm text-ink-900 self-center">
        {children || <span className="text-ink-300">—</span>}
      </div>
    </div>
  );
}
