/** Tiny shared editor controls (moved out of App.tsx for reuse). */
import { useState, type CSSProperties, type ReactNode } from "react";
import { C, MONO, inputStyle, rowLabel, segBtn, trough } from "./chrome";

/** "24" → "24px": bare numbers in length fields mean pixels, like every
 * design tool. Keeps calc()/var()/keywords untouched. */
export function normalizeLen(v: string): string {
  const t = v.trim();
  return /^-?\d+(\.\d+)?$/.test(t) && t !== "0" ? `${t}px` : t;
}

export const LENGTH_PROPS = new Set([
  "width", "maxWidth", "minWidth", "height", "maxHeight", "minHeight",
  "top", "right", "bottom", "left", "padding", "gap",
]);

export function Field({
  value,
  placeholder,
  mono,
  style,
  onCommit,
  title,
}: {
  value: string;
  placeholder?: string;
  mono?: boolean;
  style?: CSSProperties;
  title?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  return (
    <input
      className="fc"
      type="text"
      value={draft}
      placeholder={placeholder}
      title={title}
      style={{ ...inputStyle, ...(mono ? { fontFamily: MONO, fontSize: 11 } : {}), ...style }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
        e.stopPropagation();
      }}
    />
  );
}

export function Seg({
  items,
  grow,
}: {
  items: { label: string; active: boolean; onClick: () => void }[];
  grow?: boolean;
}) {
  return (
    <div style={{ ...trough, ...(grow ? { flex: "1 1 0", minWidth: 0 } : {}) }}>
      {items.map((it) => (
        <button
          key={it.label}
          style={segBtn(it.active, grow ? { flex: 1, minWidth: 0, padding: "0 4px" } : undefined)}
          onClick={it.onClick}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ ...rowLabel, whiteSpace: "nowrap", lineHeight: 1.25 }}>{label}</span>
      {children}
    </div>
  );
}

/** Material Symbols glyph (rounded set, self-hosted font). */
export function Sym({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <span aria-hidden className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1 }}>
      {name}
    </span>
  );
}

export const sectionLabel: CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: C.muted,
  fontWeight: 700,
  marginTop: 4,
};
