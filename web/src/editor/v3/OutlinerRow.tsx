/** One row of the Outliner trees (page tree, project list, route tree). */
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
  dim,
  onToggle,
  onClick,
  onCtx,
}: {
  pad: number;
  glyph: string;
  glyphColor: string;
  label: string;
  selected?: boolean;
  mark?: string;
  caret?: string;
  note?: boolean;
  data?: boolean;
  right?: string;
  /** Dimmed label (route groups, disabled entries). */
  dim?: boolean;
  onToggle?: () => void;
  onClick: () => void;
  onCtx?: (e: { preventDefault(): void; clientX: number; clientY: number }) => void;
}) {
  return (
    <div
      className="hv-row"
      style={{ display: "flex", alignItems: "center", gap: 5, height: 20, paddingRight: 8, paddingLeft: pad, background: selected ? C.ctlHover : "transparent", borderLeft: `2px solid ${selected && mark ? mark : "transparent"}`, cursor: "pointer" }}
      onClick={onClick}
      onContextMenu={onCtx}
    >
      <button
        style={{ flex: "0 0 11px", width: 11, background: "none", border: "none", padding: 0, color: C.faint, fontSize: 9, cursor: "pointer", lineHeight: 1 }}
        onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
      >
        {caret ?? ""}
      </button>
      <span style={{ flex: "0 0 auto", width: 12, textAlign: "center", color: glyphColor, fontSize: 11 }}>{glyph}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "#fff" : dim ? C.faint : C.body }}>{label}</span>
      {right && <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 10, color: C.faint }}>{right}</span>}
      {note && <span style={{ flex: "0 0 auto", color: C.amber, fontSize: 10 }}>✎</span>}
      {data && <span style={{ flex: "0 0 auto", width: 5, height: 5, borderRadius: 99, background: C.amber }} />}
    </div>
  );
}
