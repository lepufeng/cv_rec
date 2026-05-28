/**
 * Render an open-ended `extra_section` produced by the AI.
 *
 * The AI picks `title` and `style` based on the original resume content;
 * this component is a pure renderer with no hard-coded labels.
 */
type Style = "pills" | "list" | "text";

export type ExtraSectionData = {
  title: string;
  style?: Style;
  items: string[];
};

export function DynamicSection({
  section,
  variant = "default",
}: {
  section: ExtraSectionData;
  /** "default" muted ink palette; "honor" uses amber to highlight awards. */
  variant?: "default" | "honor";
}) {
  if (!section.items || section.items.length === 0) return null;

  const style: Style = section.style || "list";
  const pillClass =
    variant === "honor"
      ? "pill bg-amber-50 text-amber-800 ring-1 ring-amber-200"
      : "pill-muted";

  return (
    <div className="mt-3">
      <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">
        {section.title}
      </div>
      {style === "pills" && (
        <div className="flex flex-wrap gap-1.5">
          {section.items.map((it, i) => (
            <span key={i} className={pillClass}>
              {it}
            </span>
          ))}
        </div>
      )}
      {style === "list" && (
        <ul className="text-sm text-ink-700 list-disc list-inside space-y-0.5">
          {section.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
      {style === "text" && (
        <p className="text-sm text-ink-700 whitespace-pre-wrap">
          {section.items.join("\n")}
        </p>
      )}
    </div>
  );
}

export function DynamicSections({
  sections,
}: {
  sections: ExtraSectionData[] | undefined | null;
}) {
  if (!sections || sections.length === 0) return null;
  return (
    <>
      {sections.map((s, i) => (
        <DynamicSection key={`${s.title}-${i}`} section={s} />
      ))}
    </>
  );
}
