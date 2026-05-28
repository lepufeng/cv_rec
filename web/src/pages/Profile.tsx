import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Card,
  EmptyState,
  ErrorBanner,
  FieldRow,
  PageHeader,
  StatusPill,
} from "@/components/UI";
import {
  DynamicSection,
  DynamicSections,
  type ExtraSectionData,
} from "@/components/DynamicSection";
import { ParseProgress, type ParsePhase } from "@/components/ParseProgress";
import {
  endpoints,
  HttpError,
  type ResumeFact,
  type ResumeData,
  type ResumeDetail,
} from "@/lib/api";
const BASIC_FIELDS: Array<[keyof ResumeData["basic_info"] & string, string]> = [
  ["name", "姓名"],
  ["gender", "性别"],
  ["birth_date", "出生日期"],
  ["age", "年龄"],
  ["phone", "手机"],
  ["email", "邮箱"],
  ["location", "现居"],
  ["hometown", "籍贯"],
  ["marital_status", "婚姻"],
  ["political_status", "政治面貌"],
  ["ethnicity", "民族"],
];

export default function Profile() {
  const [resumes, setResumes] = useState<ResumeDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const list = await endpoints.listResumes();
      setResumes(list);
      const target = params.get("rid") || list[0]?.resume_id || null;
      setActiveId(target);
    } catch (err) {
      if (err instanceof HttpError) setError(err.payload.message);
      else setError("加载失败");
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(
    () => resumes?.find((r) => r.resume_id === activeId) || null,
    [resumes, activeId],
  );

  async function handleDelete(id: string) {
    if (!confirm("删除该简历？相关解析结果与缓存将同步移除。")) return;
    try {
      await endpoints.deleteResume(id);
      params.delete("rid");
      setParams(params, { replace: true });
      await refresh();
    } catch (err) {
      if (err instanceof HttpError) setError(err.payload.message);
    }
  }

  if (resumes === null) {
    return <div className="text-sm text-ink-500">加载中…</div>;
  }

  if (resumes.length === 0) {
    return (
      <div>
        <PageHeader title="我的简历" />
        <Card>
          <EmptyState
            title="还没有简历"
            description="上传一份简历，AI 将自动解析为结构化数据。"
            action={
              <Link to="/upload" className="btn-primary">
                上传简历
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="我的简历"
        description="AI 解析后的结构化数据。点击字段可修正。"
        action={
          <Link to="/upload" className="btn-primary">
            上传新简历
          </Link>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 lg:col-span-3">
          <Card title="简历列表" padded={false}>
            <ul className="divide-y divide-ink-100">
              {resumes.map((r) => (
                <li key={r.resume_id}>
                  <button
                    onClick={() => {
                      setActiveId(r.resume_id);
                      params.set("rid", r.resume_id);
                      setParams(params, { replace: true });
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-ink-50 transition-colors ${
                      activeId === r.resume_id ? "bg-accent-light/60" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium truncate flex-1">
                        简历 {r.resume_id.slice(0, 6)}
                      </div>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="text-xs text-ink-500 mt-1">
                      v{r.parsed_data_version} · {r.schema_version}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </aside>

        <section className="col-span-12 lg:col-span-9 space-y-6">
          {active && active.data ? (
            <ResumeViewer
              key={active.resume_id}
              detail={active}
              onDelete={() => handleDelete(active.resume_id)}
              onUpdated={refresh}
            />
          ) : active ? (
            <Card>
              <p className="text-sm text-ink-500">
                {active.error
                  ? `解析失败：${active.error}`
                  : "解析处理中…"}
              </p>
            </Card>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ResumeViewer({
  detail,
  onDelete,
  onUpdated,
}: {
  detail: ResumeDetail;
  onDelete: () => void;
  onUpdated: () => void;
}) {
  const [reparsePhase, setReparsePhase] = useState<ParsePhase>("idle");
  const [reparseError, setReparseError] = useState<string | null>(null);
  const data = detail.data!;
  const internshipExperience = data.internship_experience || [];
  const workExperience = data.work_experience || [];
  const campusExperience = data.campus_experience || [];
  const reparsing = reparsePhase === "parsing" || reparsePhase === "uploading";

  async function handleReparse() {
    if (!confirm("重新解析将覆盖当前结构化数据，并清除已生成的填写方案缓存。继续？")) return;
    setReparseError(null);
    setReparsePhase("parsing");
    try {
      await endpoints.reparseResume(detail.resume_id);
      setReparsePhase("done");
      setTimeout(() => {
        setReparsePhase("idle");
        onUpdated();
      }, 500);
    } catch (err) {
      setReparsePhase("failed");
      setReparseError(
        err instanceof HttpError ? err.payload.message : "重新解析失败",
      );
    }
  }

  return (
    <>
      <Card
        title="基本信息"
        action={
          <div className="flex gap-2">
            <span className="pill-muted self-center">
              v{detail.parsed_data_version}
            </span>
            <button
              className="btn-secondary"
              onClick={handleReparse}
              disabled={reparsing}
            >
              {reparsing ? "解析中…" : "重新解析"}
            </button>
            <button className="btn-danger" onClick={onDelete}>
              删除
            </button>
          </div>
        }
      >
        {reparsePhase !== "idle" && (
          <div className="mb-5">
            <ParseProgress phase={reparsePhase} />
            {reparseError && (
              <p className="text-xs text-red-700 mt-2">{reparseError}</p>
            )}
          </div>
        )}
        {(data.basic_info as any).parse_warnings &&
          (data.basic_info as any).parse_warnings.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="font-medium mb-1">解析提示 — 以下字段建议人工确认</div>
              <ul className="list-disc list-inside space-y-0.5">
                {((data.basic_info as any).parse_warnings as string[]).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          {BASIC_FIELDS.map(([k, label]) => (
            <EditableField
              key={k}
              label={label}
              value={data.basic_info[k]}
              path={["basic_info", k]}
              resumeId={detail.resume_id}
              onSaved={onUpdated}
            />
          ))}
        </div>
      </Card>

      {data.job_intent && (
        <Card title="求职意向">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <EditableField
              label="目标岗位"
              value={data.job_intent.target_position as string | null}
              path={["job_intent", "target_position"]}
              resumeId={detail.resume_id}
              onSaved={onUpdated}
            />
            <EditableField
              label="期望薪资"
              value={data.job_intent.expected_salary as string | null}
              path={["job_intent", "expected_salary"]}
              resumeId={detail.resume_id}
              onSaved={onUpdated}
            />
            <EditableField
              label="到岗时间"
              value={data.job_intent.available_date as string | null}
              path={["job_intent", "available_date"]}
              resumeId={detail.resume_id}
              onSaved={onUpdated}
            />
            <FieldRow label="期望城市">
              {(data.job_intent.work_location_preference as string[])?.join(
                "、",
              ) || ""}
            </FieldRow>
          </div>
        </Card>
      )}

      <Card title="教育经历">
        {data.education.length === 0 ? (
          <p className="text-sm text-ink-500">无</p>
        ) : (
          <div className="space-y-5">
            {data.education.map((e: any, i: number) => (
              <EducationItem key={i} item={e} />
            ))}
          </div>
        )}
      </Card>

      <Card title="实习经历">
        {internshipExperience.length === 0 ? (
          <p className="text-sm text-ink-500">无</p>
        ) : (
          <div className="space-y-4">
            {internshipExperience.map((w: any, i: number) => (
              <ExperienceItem
                key={i}
                head={w.company}
                meta={w.title}
                period={`${w.start_date || ""} — ${w.end_date || "至今"}`}
                extra={w.department}
                bullets={w.achievements || []}
                tags={w.tech_stack || []}
                extraSections={w.extra_sections}
              />
            ))}
          </div>
        )}
      </Card>

      {campusExperience.length > 0 && (
        <Card title="校园经历">
          <div className="space-y-4">
            {campusExperience.map((c: any, i: number) => (
              <ExperienceItem
                key={i}
                head={c.organization}
                meta={c.role}
                period={[c.start_date, c.end_date].filter(Boolean).join(" — ")}
                extra={[c.category, c.department].filter(Boolean).join(" · ")}
                bullets={c.achievements || []}
                tags={c.tags || []}
                extraSections={c.extra_sections}
              />
            ))}
          </div>
        </Card>
      )}

      <Card title="工作经历">
        {workExperience.length === 0 ? (
          <p className="text-sm text-ink-500">无</p>
        ) : (
          <div className="space-y-4">
            {workExperience.map((w: any, i: number) => (
              <ExperienceItem
                key={i}
                head={w.company}
                meta={w.title}
                period={`${w.start_date || ""} — ${w.end_date || "至今"}`}
                extra={w.department}
                bullets={w.achievements || []}
                tags={w.tech_stack || []}
                extraSections={w.extra_sections}
              />
            ))}
          </div>
        )}
      </Card>

      {data.project_experience.length > 0 && (
        <Card title="项目经历">
          <div className="space-y-4">
            {data.project_experience.map((p: any, i: number) => (
              <ExperienceItem
                key={i}
                head={p.name}
                meta={p.role}
                period={`${p.start_date || ""} — ${p.end_date || ""}`}
                description={p.description}
                bullets={p.achievements || []}
                tags={p.tech_stack || []}
                extraSections={p.extra_sections}
              />
            ))}
          </div>
        </Card>
      )}

      <Card title="技能">
        <div className="space-y-3">
          {Object.entries(data.skills).map(([k, list]) =>
            (list as string[]).length === 0 ? null : (
              <div key={k}>
                <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">
                  {SKILL_LABELS[k] || k}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(list as string[]).map((s, i) => (
                    <span key={i} className="pill-muted">{s}</span>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      </Card>

      {(data.certifications.length > 0 || data.languages.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.certifications.length > 0 && (
            <Card title="证书">
              <ul className="text-sm space-y-1">
                {data.certifications.map((c: any, i: number) => (
                  <li key={i}>
                    {c.name}
                    {c.issuer && (
                      <span className="text-ink-500"> · {c.issuer}</span>
                    )}
                    {c.date && (
                      <span className="text-ink-500"> ({c.date})</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.languages.length > 0 && (
            <Card title="语言">
              <ul className="text-sm space-y-1">
                {data.languages.map((l: any, i: number) => (
                  <li key={i}>
                    {l.language}
                    {l.level && (
                      <span className="text-ink-500"> · {l.level}</span>
                    )}
                    {l.score && (
                      <span className="text-ink-500"> ({l.score})</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {data.self_evaluation && (
        <Card title="自我评价">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {data.self_evaluation}
          </p>
        </Card>
      )}

      {data.facts && data.facts.length > 0 && (
        <Card title="动态信息">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.facts.map((fact, i) => (
              <FactItem key={`${fact.key || fact.label}-${i}`} fact={fact} />
            ))}
          </div>
        </Card>
      )}

      {data.extra_sections && data.extra_sections.length > 0 && (
        <Card title="其他">
          <div className="-mt-3">
            <DynamicSections
              sections={data.extra_sections as ExtraSectionData[]}
            />
          </div>
        </Card>
      )}
    </>
  );
}

const SKILL_LABELS: Record<string, string> = {
  programming_languages: "编程语言",
  frameworks: "框架",
  databases: "数据库",
  middleware: "中间件",
  cloud_native: "云原生",
  tools: "工具",
  soft_skills: "软技能",
};

function FactItem({ fact }: { fact: ResumeFact }) {
  const confidence =
    fact.confidence == null ? null : `${Math.round(fact.confidence * 100)}%`;
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-ink-500">
          {fact.label}
        </div>
        {confidence && <span className="pill-muted text-[11px]">{confidence}</span>}
      </div>
      <div className="text-sm text-ink-900 mt-1">{fact.value}</div>
      {(fact.source_text || fact.scope) && (
        <div className="text-xs text-ink-500 mt-1">
          {fact.source_text || fact.scope}
        </div>
      )}
    </div>
  );
}

function ExperienceItem({
  head,
  meta,
  period,
  description,
  extra,
  bullets,
  tags,
  extraSections,
}: {
  head: string;
  meta?: string | null;
  period?: string | null;
  description?: string | null;
  extra?: string | null;
  bullets?: string[];
  tags?: string[];
  extraSections?: ExtraSectionData[];
}) {
  // Combine description (when present) with bullets so all items render with
  // the same disc marker — the model occasionally classifies the first bullet
  // as `description`, and we don't want users to see it as a paragraph.
  const allBullets = [
    ...(description ? [description] : []),
    ...(bullets ?? []),
  ];
  return (
    <article className="border-l-2 border-ink-200 pl-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="font-medium">{head}</h3>
          {meta && <p className="text-sm text-ink-500">{meta}</p>}
        </div>
        {period && <span className="text-xs text-ink-500 font-mono">{period}</span>}
      </div>
      {extra && <p className="text-xs text-ink-500 mt-1">{extra}</p>}
      {allBullets.length > 0 && (
        <ul className="mt-2 text-sm text-ink-700 list-disc list-inside space-y-0.5">
          {allBullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {tags.map((t, i) => (
            <span key={i} className="pill-muted">{t}</span>
          ))}
        </div>
      )}
      <DynamicSections sections={extraSections} />
    </article>
  );
}

function EducationItem({ item }: { item: any }) {
  const meta = [item.degree, item.major].filter(Boolean).join(" · ");
  const period = `${item.start_date || ""} — ${item.end_date || "至今"}`;
  return (
    <article className="border-l-2 border-ink-200 pl-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="font-medium">{item.school || "(未知学校)"}</h3>
          {meta && <p className="text-sm text-ink-500">{meta}</p>}
        </div>
        <span className="text-xs text-ink-500 font-mono">{period}</span>
      </div>
      {item.gpa && (
        <p className="text-xs text-ink-500 mt-1">GPA: {item.gpa}</p>
      )}
      {item.ranking && (
        <DynamicSection
          section={{ title: "排名", style: "text", items: [formatRanking(item.ranking)] }}
        />
      )}
      {item.honors && item.honors.length > 0 && (
        <DynamicSection
          section={{ title: "荣誉 / 奖项", style: "pills", items: item.honors }}
          variant="honor"
        />
      )}
      {item.courses && item.courses.length > 0 && (
        <DynamicSection
          section={{ title: "主要课程", style: "pills", items: item.courses }}
        />
      )}
      <DynamicSections sections={item.extra_sections as ExtraSectionData[]} />
    </article>
  );
}

function formatRanking(ranking: any): string {
  if (typeof ranking === "string") return ranking;
  if (ranking.raw) return ranking.raw;
  const parts: string[] = [];
  if (ranking.context) parts.push(ranking.context);
  if (ranking.rank != null && ranking.total != null) {
    parts.push(`${ranking.rank}/${ranking.total}`);
  } else if (ranking.rank != null) {
    parts.push(`第 ${ranking.rank} 名`);
  }
  if (ranking.percentile) parts.push(ranking.percentile);
  return parts.join(" · ");
}

function EditableField({
  label,
  value,
  path,
  resumeId,
  onSaved,
}: {
  label: string;
  value: string | number | null | undefined;
  path: string[];
  resumeId: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const display = value == null || value === "" ? "—" : String(value);

  async function save() {
    setSaving(true);
    try {
      const patch: Record<string, any> = {};
      // Build nested patch
      let cursor = patch;
      for (let i = 0; i < path.length - 1; i++) {
        cursor[path[i]] = {};
        cursor = cursor[path[i]];
      }
      cursor[path[path.length - 1]] = draft || null;
      await endpoints.patchResume(resumeId, patch);
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-ink-100 last:border-b-0 group">
      <div className="text-xs uppercase tracking-wide text-ink-500 self-center">
        {label}
      </div>
      <div className="col-span-2 text-sm self-center flex items-center gap-2">
        {editing ? (
          <>
            <input
              className="input !py-1 !text-sm flex-1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button
              className="btn-primary !py-1 !px-3 !text-xs"
              onClick={save}
              disabled={saving}
            >
              保存
            </button>
            <button
              className="btn-secondary !py-1 !px-3 !text-xs"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <span
              className={value == null || value === "" ? "text-ink-300" : "text-ink-900"}
            >
              {display}
            </span>
            <button
              className="opacity-0 group-hover:opacity-100 text-xs text-accent hover:underline transition"
              onClick={() => {
                setDraft(value == null ? "" : String(value));
                setEditing(true);
              }}
            >
              修改
            </button>
          </>
        )}
      </div>
    </div>
  );
}
