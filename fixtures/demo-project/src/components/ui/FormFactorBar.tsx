"use client";

// ---------------------------------------------------------------------------
// <FormFactorBar />
// ---------------------------------------------------------------------------
// Glass pill(s) inside a trough track. Displays mutually exclusive
// form-factor options. When `labels` is provided, renders multiple
// segments with one selected. When only `title` is provided, renders
// a single pill label (definition/axis-name mode).

interface FormFactorBarProps {
  /** Single label mode — one pill showing the axis name. */
  title?: string;
  /** Multi-segment mode — array of option labels with one selected. */
  labels?: string[];
  /** Index of the selected segment (multi-segment mode). */
  selected?: number;
}

export function FormFactorBar({ title, labels, selected = 0 }: FormFactorBarProps) {
  const items = labels ?? (title ? [title] : []);
  if (items.length === 0) return null;

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 12,
        background:
          "linear-gradient(180deg, var(--ui-trough-grad-top), var(--ui-trough-grad-mid) 55%, var(--ui-trough-grad-bot))",
        boxShadow:
          "inset 0 2px 4px var(--ui-trough-inset-top), inset 0 -1px 0 var(--ui-trough-floor-hi)",
      }}
    >
      {items.map((label, i) => {
        const isActive = labels ? i === selected : true;
        return (
          <div
            key={label}
            className={isActive ? "ui-glass-pill" : undefined}
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              padding: "0.25rem 0.625rem",
              borderRadius: 8,
              color: isActive
                ? "var(--ui-text-primary)"
                : "var(--ui-text-faint)",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}
