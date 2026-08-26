/** One row of the Outliner trees (page tree, project list, route tree).
 *  Blender-styled: full-width rounded highlight bar for selection, a faint
 *  white wash on hover layered on top (v3.css .hv-row:hover::after), real
 *  Material Symbols icons, and vertical hierarchy guides drawn per row so
 *  they stack into continuous lines. */
import type { ReactNode } from "react";
import { C, MONO } from "./chrome";

export function OutlinerRow({
  pad,
  glyph,
  glyphColor,
  label,
  selected,
  mark,
  caret,
  note,
  data,
  right,
  after,
  dim,
  guideXs,
  onToggle,
  onClick,
  onCtx,
}: {
  pad: number;
  /** Material Symbols name (rounded set). */
  glyph: string;
  glyphColor: string;
  label: string;
  selected?: boolean;
  mark?: string;
  caret?: "open" | "closed";
  note?: boolean;
  data?: boolean;
  right?: string;
  /** Inline content right after the label (e.g. collapsed-subtree icon summary). */
  after?: ReactNode;
  /** Dimmed row (route groups, dynamic elements, disabled entries). */
  dim?: boolean;
  /** x offsets of ancestor hierarchy guide lines. */
  guideXs?: number[];
  onToggle?: () => void;
  onClick: () => void;
  onCtx?: (e: { preventDefault(): void; clientX: number; clientY: number }) => void;
}) {
  return (
    <div
      className="hv-row"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: 20,
        paddingRight: 8,
        paddingLeft: pad,
        borderRadius: 4,
        background: selected ? C.ctlHover : "transparent",
        boxShadow: selected && mark ? `inset 0 0 0 1px ${mark}66` : undefined,
        cursor: "pointer",
      }}
      onClick={onClick}
      onContextMenu={onCtx}
    >
      {guideXs?.map((x) => (
        <span
          key={x}
          style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: C.softDiv, pointerEvents: "none" }}
        />
      ))}
      <button
        style={{ flex: "0 0 13px", width: 13, background: "none", border: "none", padding: 0, color: C.faint, cursor: "pointer", lineHeight: 1 }}
        onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
      >
        {caret && (
          <span aria-hidden className="material-symbols-rounded" style={{ fontSize: 15, lineHeight: 1, verticalAlign: "middle" }}>
            {caret === "open" ? "arrow_drop_down" : "arrow_right"}
          </span>
        )}
      </button>
      <span
        aria-hidden
        className="material-symbols-rounded"
        style={{ flex: "0 0 auto", width: 15, textAlign: "center", color: glyphColor, fontSize: 13, lineHeight: 1, opacity: dim ? 0.55 : 1 }}
      >
        {glyph}
      </span>
      <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "#fff" : dim ? C.faint : C.body }}>{label}</span>
      {after}
      <span style={{ flex: 1 }} />
      {right && <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 10, color: C.faint }}>{right}</span>}
      {note && <span style={{ flex: "0 0 auto", color: C.amber, fontSize: 10 }}>✎</span>}
      {data && <span style={{ flex: "0 0 auto", width: 5, height: 5, borderRadius: 99, background: C.amber }} />}
    </div>
  );
}
