/**
 * Workshop workspace — the material studio. A draggable node graph (Light,
 * Surface, Shadow, Depth, Rim → Material output) resolves to a box-shadow
 * recipe; "Write tokens" persists --material-* declarations into the real
 * theme.css via /api/material.
 */
import { useEffect, useRef, useState } from "react";
import { C, MONO, sectionHeader } from "./chrome";

export interface Mat {
  angle: number;
  distance: number;
  blur: number;
  spread: number;
  tint: string;
  innerMix: number;
  rim: number;
  radius: number;
  pressed: number;
}
export const MAT_DEFAULT: Mat = { angle: 135, distance: 5, blur: 14, spread: 0, tint: "#f3e8db", innerMix: 16, rim: 95, radius: 10, pressed: 60 };
export const MAT_PRESETS: Record<string, Mat> = {
  Raised: { ...MAT_DEFAULT },
  Inset: { ...MAT_DEFAULT, innerMix: 88, blur: 10, distance: 4, rim: 30 },
  Flat: { ...MAT_DEFAULT, innerMix: 0, blur: 4, distance: 1, spread: 0, rim: 40 },
};

export interface WorkshopState {
  matName: string;
  matPreset: string;
  mat: Mat;
  matEdits: number;
  written: boolean;
  graphZoom: number;
}
export const WS_INITIAL: WorkshopState = {
  matName: "surface-raised",
  matPreset: "Raised",
  mat: { ...MAT_DEFAULT },
  matEdits: 0,
  written: false,
  graphZoom: 1,
};

const WS_SUBJECTS = [
  { name: "New primitive", items: [["Button", "▭"], ["Card", "▤"], ["Field", "⌷"], ["Pill", "▰"]] as [string, string][] },
  { name: "From kit", items: [["SearchBar", "⌕"], ["Badge", "◈"], ["Switch", "⊙"], ["Navbar", "≡"]] as [string, string][] },
];
const WS_PARTS: Record<string, string[]> = {
  Button: ["Surface", "Label", "Focus ring"], Card: ["Surface", "Rim", "Content"],
  Field: ["Well", "Text", "Focus ring"], Pill: ["Surface", "Label"],
  SearchBar: ["Well", "Icon", "Text"], Badge: ["Surface", "Label"],
  Switch: ["Track", "Knob"], Navbar: ["Bar", "Item", "Active item"],
};
const WS_STATES = ["Default", "Hover", "Pressed", "Disabled"] as const;
const MAT_SLOTS = ["raised", "inset", "flat"];
const PREVIEW_KIND: Record<string, "button" | "card" | "field"> = {
  Button: "button", Pill: "button", Badge: "button", Switch: "button", Navbar: "button",
  Card: "card", Field: "field", SearchBar: "field",
};
const PREVIEW_LABEL: Record<string, string> = {
  Button: "Set alert", Pill: "verified", Badge: "Verified", Switch: "On", Navbar: "Alerts",
  Card: "Source coverage", Field: "Search bookings", SearchBar: "Search bookings",
};
const NODE_POS_DEFAULT: Record<string, { x: number; y: number }> = {
  light: { x: 20, y: 18 }, surface: { x: 20, y: 156 }, shadow: { x: 250, y: 18 },
  depth: { x: 250, y: 152 }, rim: { x: 250, y: 286 }, out: { x: 492, y: 120 },
};

/** One material resolved to a box-shadow. Outer and inner pairs are the two
 * halves of the same light: the ratio is the Depth node's inner/outer mix. */
export function matShadow(m: Mat, state: (typeof WS_STATES)[number]): string {
  const pressed = state === "Pressed";
  const rad = (m.angle * Math.PI) / 180;
  const dist = m.distance * (state === "Hover" ? 1.4 : state === "Disabled" ? 0.4 : 1);
  const dx = Math.round(Math.cos(rad) * dist * 10) / 10;
  const dy = Math.round(Math.sin(rad) * dist * 10) / 10;
  const blur = Math.round(m.blur * (pressed ? 0.7 : state === "Disabled" ? 0.6 : 1) * 10) / 10;
  const inner = pressed ? Math.max(m.innerMix, m.pressed) / 100 : m.innerMix / 100;
  const outer = 1 - inner;
  const dim = state === "Disabled" ? 0.5 : 1;
  const parts: string[] = [];
  if (outer > 0.02) {
    parts.push(`${dx}px ${dy}px ${blur}px ${m.spread}px rgba(44,34,30,${(0.34 * outer * dim).toFixed(3)})`);
    parts.push(`${-dx}px ${-dy}px ${blur}px ${m.spread}px rgba(255,255,255,${(0.6 * outer * dim).toFixed(3)})`);
  }
  if (inner > 0.02) {
    parts.push(`inset ${dx}px ${dy}px ${blur}px rgba(44,34,30,${(0.34 * inner * dim).toFixed(3)})`);
    parts.push(`inset ${-dx}px ${-dy}px ${blur}px rgba(255,255,255,${(0.55 * inner * dim).toFixed(3)})`);
  }
  if (m.rim > 2) parts.push(`inset 0 1px 0 rgba(255,255,255,${(m.rim / 100).toFixed(2)})`);
  return parts.join(", ");
}

export function materialLines(ws: WorkshopState): string[] {
  return [
    `--material-${ws.matName}-radius: ${ws.mat.radius}px;`,
    `--material-${ws.matName}-surface: ${ws.mat.tint};`,
    `--material-${ws.matName}-shadow: ${matShadow(ws.mat, "Default")};`,
    `--material-${ws.matName}-shadow-pressed: ${matShadow(ws.mat, "Pressed")};`,
  ];
}

// ---------------------------------------------------------------------------

export function WorkshopBody({
  ws,
  setWs,
}: {
  ws: WorkshopState;
  setWs: (up: (w: WorkshopState) => WorkshopState) => void;
}) {
  const [subject, setSubject] = useState("Button");
  const [wsState, setWsState] = useState<(typeof WS_STATES)[number]>("Default");
  const [partMat, setPartMat] = useState<Record<string, string>>({});
  const [nodePos, setNodePos] = useState({ ...NODE_POS_DEFAULT });
  const [selNode, setSelNode] = useState("surface");
  const dragRef = useRef<{ id: string; cx: number; cy: number; ox: number; oy: number } | null>(null);
  const graphRef = useRef<HTMLDivElement>(null);

  const m = ws.mat;
  const setMat = (key: keyof Mat, value: number | string) =>
    setWs((w) => ({ ...w, mat: { ...w.mat, [key]: value }, matEdits: w.matEdits + 1, matPreset: "", written: false }));

  // Node dragging
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setNodePos((p) => ({
        ...p,
        [d.id]: {
          x: Math.max(0, d.ox + (e.clientX - d.cx) / ws.graphZoom),
          y: Math.max(0, d.oy + (e.clientY - d.cy) / ws.graphZoom),
        },
      }));
    };
    const up = () => (dragRef.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [ws.graphZoom]);

  // Ctrl+wheel zoom + middle-mouse pan on the graph
  useEffect(() => {
    const el = graphRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setWs((w) => ({ ...w, graphZoom: Math.min(1.6, Math.max(0.5, w.graphZoom * (e.deltaY < 0 ? 1.08 : 0.92))) }));
    };
    let pan: { x: number; y: number } | null = null;
    const down = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY };
      el.style.cursor = "grabbing";
    };
    const move = (e: MouseEvent) => {
      if (!pan) return;
      el.scrollLeft += pan.x - e.clientX;
      el.scrollTop += pan.y - e.clientY;
      pan = { x: e.clientX, y: e.clientY };
    };
    const up = (e: MouseEvent) => {
      if (e.button !== 1) return;
      pan = null;
      el.style.cursor = "";
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [setWs]);

  const shadow = matShadow(m, wsState);
  const kind = PREVIEW_KIND[subject] ?? "button";
  const ground = "#F5EADD";
  const pageFg = "#2C221E";
  const pageMutedFg = "rgba(44,34,30,0.62)";

  interface Control {
    label: string;
    display: string;
    range?: { min: number; max: number; step: number; value: number; key: keyof Mat; unit: string };
    swatches?: { color: string; on: boolean }[];
    readout?: string;
  }
  const rng = (label: string, key: keyof Mat, min: number, max: number, step: number, unit: string): Control => ({
    label, display: `${m[key]}${unit}`, range: { min, max, step, value: m[key] as number, key, unit },
  });
  const defs: { id: string; title: string; w: number; ins: number; controls: Control[] }[] = [
    { id: "light", title: "Light", w: 196, ins: 0, controls: [rng("Angle", "angle", 0, 360, 1, "°"), rng("Distance", "distance", 0, 24, 0.5, "px")] },
    { id: "surface", title: "Surface", w: 196, ins: 0, controls: [
      { label: "Surface tint", display: m.tint, swatches: ["#f9f3eb", "#f3e8db", "#F0E5D9", "#F5EADD"].map((c) => ({ color: c, on: c.toLowerCase() === m.tint.toLowerCase() })) },
      rng("Corner radius", "radius", 0, 28, 1, "px"),
    ]},
    { id: "shadow", title: "Shadow", w: 196, ins: 1, controls: [rng("Blur", "blur", 0, 40, 1, "px"), rng("Spread", "spread", -8, 8, 0.5, "px")] },
    { id: "depth", title: "Depth", w: 196, ins: 1, controls: [rng("Inner / outer", "innerMix", 0, 100, 1, "%"), rng("Pressed depth", "pressed", 0, 100, 1, "%")] },
    { id: "rim", title: "Rim highlight", w: 196, ins: 1, controls: [rng("Strength", "rim", 0, 100, 1, "%")] },
    { id: "out", title: `Material · ${ws.matName}`, w: 244, ins: 4, controls: [{ label: "box-shadow", display: "", readout: matShadow(m, "Default") }] },
  ];
  const nodes = defs.map((d) => ({ ...d, ...(nodePos[d.id] ?? { x: 0, y: 0 }), on: selNode === d.id }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const outPt = (n: (typeof nodes)[number]) => [n.x + n.w, n.y + 15] as const;
  const inPt = (n: (typeof nodes)[number], i: number) => [n.x, n.y + 31 + i * 16] as const;
  const link = (from: string, to: string, i: number) => {
    const a = outPt(byId[from]);
    const b = inPt(byId[to], i);
    const bend = Math.max(6, Math.min(Math.abs(b[0] - a[0]) / 2, 70));
    const lit = selNode === from || selNode === to;
    return { d: `M ${a[0]} ${a[1]} C ${a[0] + bend} ${a[1]}, ${b[0] - bend} ${b[1]}, ${b[0]} ${b[1]}`, color: lit ? C.muted : C.borderHover };
  };
  const wires = [link("light", "shadow", 0), link("light", "rim", 0), link("surface", "out", 0), link("shadow", "out", 1), link("depth", "out", 2), link("rim", "out", 3)];
  const graphW = Math.max(760, ...nodes.map((n) => n.x + n.w + 40));
  const graphH = Math.max(470, ...nodes.map((n) => n.y + 230));

  const pill = (on: boolean) => ({ background: on ? C.ctlHover : C.ctl, border: `1px solid ${on ? C.blue : C.border}`, color: on ? "#fff" : C.muted });

  return (
    <>
      {/* left: Build / Anatomy / States */}
      <div style={{ flex: "0 1 236px", minWidth: 186, display: "flex", flexDirection: "column", background: C.panel, borderRight: `1px solid ${C.border}`, minHeight: 0 }}>
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 6px", whiteSpace: "nowrap" }}>
          <h2 style={{ ...sectionHeader, flex: 1, minWidth: 0 }}>Build</h2>
          <span style={{ flex: "0 0 auto", fontSize: 10, color: C.faint }}>part by part</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0 }}>
          {WS_SUBJECTS.map((g) => (
            <div key={g.name} style={{ borderTop: `1px solid ${C.softDiv}` }}>
              <div style={{ padding: "8px 10px 5px", fontSize: 11, color: C.body, fontWeight: 600 }}>{g.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "0 10px 8px" }}>
                {g.items.map(([label, icon]) => (
                  <button key={label} className="hv-card" onClick={() => setSubject(label)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", ...pill(label === subject), borderRadius: 5, cursor: "pointer", textAlign: "left", overflow: "hidden", whiteSpace: "nowrap" }}>
                    <span style={{ flex: "0 0 auto", color: C.blueLight, width: 12, textAlign: "center" }}>{icon}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.softDiv}` }}>
            <div style={{ padding: "8px 10px 5px", display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ flex: "0 0 auto", fontSize: 11, color: C.body, fontWeight: 600 }}>Anatomy</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 10, color: C.faint }}>{subject}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 10px 10px" }}>
              {(WS_PARTS[subject] ?? []).map((label) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, color: C.body }}>{label}</span>
                  <select
                    className="fc"
                    value={partMat[`${subject}·${label}`] ?? MAT_SLOTS[0]}
                    onChange={(e) => setPartMat((p) => ({ ...p, [`${subject}·${label}`]: e.target.value }))}
                    style={{ flex: "0 0 88px", boxSizing: "border-box", height: 20, background: C.sunken, border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10.5, padding: "0 3px" }}
                  >
                    {MAT_SLOTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.softDiv}` }}>
            <div style={{ padding: "8px 10px 5px", fontSize: 11, color: C.body, fontWeight: 600 }}>States</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "0 10px 12px" }}>
              {WS_STATES.map((label) => (
                <button key={label} onClick={() => setWsState(label)}
                  style={{ height: 22, padding: "0 7px", ...pill(label === wsState), borderRadius: 5, cursor: "pointer", textAlign: "left", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* center: node graph + preview strip */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 260, background: C.void, minHeight: 0 }}>
        <div ref={graphRef} style={{ flex: 1, position: "relative", overflow: "auto", minHeight: 0, backgroundColor: C.void, backgroundImage: "radial-gradient(#20242c 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
          <div style={{ position: "relative", width: Math.round(graphW * ws.graphZoom), height: Math.round(graphH * ws.graphZoom) }}>
            <div style={{ position: "relative", width: graphW, height: graphH, transform: `scale(${ws.graphZoom})`, transformOrigin: "0 0" }}>
              <svg width={graphW} height={graphH} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 1 }}>
                {wires.map((w, i) => (
                  <path key={i} d={w.d} fill="none" stroke={w.color} strokeWidth={1.6} opacity={0.85} />
                ))}
              </svg>
              {nodes.map((n) => (
                <div key={n.id} onMouseDown={() => setSelNode(n.id)}
                  style={{ position: "absolute", left: n.x, top: n.y, width: n.w, background: C.menu, border: `1px solid ${n.on ? C.blue : C.border}`, borderRadius: 7, boxShadow: "0 10px 24px rgba(0,0,0,0.5)", zIndex: n.on ? 6 : 3 }}>
                  <div
                    onMouseDown={(e) => { e.preventDefault(); setSelNode(n.id); dragRef.current = { id: n.id, cx: e.clientX, cy: e.clientY, ox: n.x, oy: n.y }; }}
                    style={{ display: "flex", alignItems: "center", gap: 6, height: 20, padding: "0 8px", background: n.on ? C.ctlHover : C.ctl, color: n.on ? "#fff" : C.muted, borderBottom: `1px solid ${C.border}`, borderRadius: "6px 6px 0 0", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", cursor: "grab", userSelect: "none" }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</span>
                    <span style={{ flex: "0 0 auto", opacity: 0.55 }}>⋮⋮</span>
                  </div>
                  <div style={{ position: "relative", padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>
                    {n.id !== "out" && (
                      <span style={{ position: "absolute", top: -14, right: -5, width: 9, height: 9, borderRadius: 9999, background: n.on ? C.muted : C.borderHover, border: `1px solid ${C.void}` }} />
                    )}
                    {Array.from({ length: n.ins }, (_, i) => (
                      <span key={i} style={{ position: "absolute", top: 6 + i * 16, left: -5, width: 9, height: 9, borderRadius: 9999, background: n.on ? C.muted : C.borderHover, border: `1px solid ${C.void}` }} />
                    ))}
                    {n.controls.map((c) => (
                      <div key={c.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 10, color: C.muted }}>{c.label}</span>
                          <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 10, color: C.body }}>{c.display}</span>
                        </div>
                        {c.range && (
                          <input type="range" min={c.range.min} max={c.range.max} step={c.range.step} value={c.range.value}
                            onChange={(e) => setMat(c.range!.key, Number(e.target.value))}
                            style={{ width: "100%", height: 12, accentColor: C.blueLight, background: "transparent", cursor: "pointer" }} />
                        )}
                        {c.swatches && (
                          <div style={{ display: "flex", gap: 4 }}>
                            {c.swatches.map((sw) => (
                              <button key={sw.color} title={sw.color} onClick={() => setMat("tint", sw.color)}
                                style={{ flex: 1, height: 18, borderRadius: 4, background: sw.color, border: `1px solid ${sw.on ? C.blueLight : "rgba(0,0,0,0.4)"}`, cursor: "pointer" }} />
                            ))}
                          </div>
                        )}
                        {c.readout && (
                          <div style={{ fontFamily: MONO, fontSize: 9.5, lineHeight: 1.5, color: C.muted, wordBreak: "break-all", background: C.sunken, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 6px" }}>{c.readout}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* preview strip */}
        <div style={{ flex: "0 0 auto", maxHeight: 134, display: "flex", flexWrap: "nowrap", gap: 10, padding: "9px 10px", background: C.canvasBar, borderTop: `1px solid ${C.border}`, overflowX: "auto", overflowY: "hidden" }}>
          <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Material</span>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 122, height: 86, borderRadius: 8, background: ground }}>
              <div style={{ width: 78, height: 52, borderRadius: m.radius, background: m.tint, boxShadow: shadow }} />
            </div>
          </div>
          <div style={{ flex: "1 1 190px", minWidth: 150, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>{subject} · {wsState}</span>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 86, padding: 12, borderRadius: 8, background: ground, boxSizing: "border-box" }}>
              {kind === "button" && (
                <span style={{ display: "inline-flex", alignItems: "center", padding: "0.55rem 1.3rem", borderRadius: m.radius, background: m.tint, boxShadow: shadow, color: pageFg, fontFamily: "Cabin, system-ui, sans-serif", fontSize: 13, opacity: wsState === "Disabled" ? 0.55 : 1 }}>{PREVIEW_LABEL[subject]}</span>
              )}
              {kind === "card" && (
                <div style={{ width: "100%", maxWidth: 250, padding: "14px 16px", borderRadius: m.radius, background: m.tint, boxShadow: shadow, color: pageFg, opacity: wsState === "Disabled" ? 0.55 : 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontFamily: "'Goudy Old Style', Georgia, serif", fontSize: 16 }}>{PREVIEW_LABEL[subject]}</span>
                  <span style={{ fontFamily: "Cabin, system-ui, sans-serif", fontSize: 11.5, color: pageMutedFg }}>Surfaces straddle the ground's luminance.</span>
                </div>
              )}
              {kind === "field" && (
                <div style={{ width: "100%", maxWidth: 250, padding: "0.6rem 0.85rem", borderRadius: m.radius, background: m.tint, boxShadow: shadow, color: pageMutedFg, fontFamily: "Cabin, system-ui, sans-serif", fontSize: 12.5, opacity: wsState === "Disabled" ? 0.55 : 1 }}>{PREVIEW_LABEL[subject]}</div>
              )}
            </div>
          </div>
          <div style={{ flex: "1 1 210px", minWidth: 160, display: "flex", flexDirection: "column", gap: 5, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Writes to the app’s globals.css</span>
              <span style={{ flex: "0 0 auto", fontSize: 9.5, color: ws.written ? C.green : C.amber }}>{ws.written ? "written" : "not written yet"}</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", maxHeight: 86, background: C.sunken, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 8px", fontFamily: MONO, fontSize: 10, lineHeight: 1.65, color: C.muted, whiteSpace: "pre" }}>
              {materialLines(ws).join("\n")}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
