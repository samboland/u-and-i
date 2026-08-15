/**
 * Chrome palette + shared style fragments, verbatim from the v3 design
 * (design/editor-redesign.dc.html). One source of values — do not restate
 * these literals in components.
 */
import type { CSSProperties } from "react";

export const C = {
  win: "#16181d",
  panel: "#1b1e24",
  void: "#101216",
  canvasBar: "#15171c",
  canvasEdge: "#1e2129",
  sunken: "#12141a",
  menu: "#1f242c",
  ctl: "#242935",
  ctlHover: "#2b3342",
  border: "#2a2e37",
  borderHover: "#3a4356",
  softDiv: "#23272f",
  text: "#e8eaee",
  body: "#d7dae0",
  muted: "#8b919d",
  faint: "#6b7280",
  blue: "#328ec1",
  blueLight: "#6fb8ea",
  green: "#5fae6f",
  amber: "#d9b45b",
  amberBg: "#3b3320",
  amberBorder: "#4a3f24",
  amberInk: "#2c221e",
  orange: "#ff6b00",
  diffMinus: "#e07a7a",
  dangerBg: "#3a2424",
  dangerBorder: "#5a3030",
  closeHover: "#c42b1c",
} as const;

export const MONO = "ui-monospace, monospace";

export const SEL_COLOR = {
  block: C.orange,
  column: C.green,
  section: C.blueLight,
  none: C.muted,
} as const;

export const DEVICES = {
  Desktop: { width: 1100, zoom: 0.62 },
  Tablet: { width: 834, zoom: 0.75 },
  Phone: { width: 390, zoom: 1 },
} as const;
export type DeviceName = keyof typeof DEVICES;

export const ZOOMS = [0.4, 0.5, 0.62, 0.75, 0.9, 1, 1.25];
export const CANVAS_STATES = ["Default", "Loading", "Empty", "Error"] as const;
export const ROLES = ["Traveler", "Advisor", "Admin", "Operator"];

// Reusable style fragments -------------------------------------------------

export const trough: CSSProperties = {
  display: "flex",
  gap: 2,
  background: C.sunken,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  padding: 2,
  flex: "0 0 auto",
};

export function segBtn(active: boolean, extra?: CSSProperties): CSSProperties {
  return {
    height: 18,
    padding: "0 8px",
    border: "none",
    borderRadius: 3,
    background: active ? C.ctlHover : "transparent",
    color: active ? "#ffffff" : C.muted,
    font: "inherit",
    cursor: "pointer",
    ...extra,
  };
}

export const ctlBtn: CSSProperties = {
  height: 22,
  padding: "0 9px",
  background: C.ctl,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  color: C.body,
  font: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

export const primaryBtn: CSSProperties = {
  ...ctlBtn,
  background: C.ctlHover,
  border: `1px solid ${C.blue}`,
  color: "#fff",
};

export const amberBtn: CSSProperties = {
  ...ctlBtn,
  background: C.amberBg,
  border: `1px solid ${C.amberBorder}`,
  color: C.amber,
};

export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 24,
  background: C.sunken,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  color: C.text,
  padding: "0 7px",
  font: "inherit",
};

export const sectionHeader: CSSProperties = {
  margin: 0,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: C.muted,
  fontWeight: 700,
};

export const vdiv: CSSProperties = {
  flex: "0 0 auto",
  width: 1,
  height: 18,
  background: C.border,
};

export const rowLabel: CSSProperties = { flex: "0 0 62px", color: C.muted };
