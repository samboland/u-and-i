"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { X, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// <Switch />
// ---------------------------------------------------------------------------
// Compact boolean toggle. Same drag/pill mechanics as the Toggle component,
// but with two square cells containing X / check icons instead of text
// labels. Window-through layering is unnecessary because the icons are
// visible through the pill's transparent label layer (no blur masks —
// the cells are too small to benefit from progressive rim blur).

interface SwitchProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Custom icon for the "off" cell. Defaults to X. */
  offIcon?: React.ReactNode;
  /** Custom icon for the "on" cell. Defaults to checkmark. */
  onIcon?: React.ReactNode;
  /** Accessible name for the switch (role="switch" carries no visible label
   *  of its own). Screen readers announce this + the on/off state. */
  ariaLabel?: string;
}

export function Switch({ value, onChange, offIcon, onIcon, ariaLabel }: SwitchProps) {
  const [visualOn, setVisualOn] = useState(value);
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  // 'none' | 'pill' (dragging the selection square) | 'bg' (pressing
  // anywhere outside the pill — whole background shows press state)
  const [pressMode, setPressMode] = useState<"none" | "pill" | "bg">("none");

  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const sharpIconsRef = useRef<HTMLDivElement>(null);
  const blurredIconsRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    pillLeft: number;
    moved: boolean;
    mode: "pill" | "bg";
  } | null>(null);

  if (dragLeft === null && visualOn !== value) {
    setVisualOn(value);
  }

  // Position the icon layer inside the pill so icons stay locked to
  // the underlying cell positions as the pill slides over them.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const pill = pillRef.current;
    if (!track || !pill) return;
    const padding = 3;
    const trackWidth = track.offsetWidth;
    const innerWidth = trackWidth - padding * 2;
    const pillLeft =
      dragLeft !== null ? dragLeft : visualOn ? trackWidth - pill.offsetWidth - padding : padding;
    const leftValue = `${padding - pillLeft}px`;
    const widthValue = `${innerWidth}px`;
    if (sharpIconsRef.current) {
      sharpIconsRef.current.style.left = leftValue;
      sharpIconsRef.current.style.width = widthValue;
    }
    if (blurredIconsRef.current) {
      blurredIconsRef.current.style.left = leftValue;
      blurredIconsRef.current.style.width = widthValue;
    }
  });

  const commit = (next: boolean) => {
    setVisualOn(next);
    if (next !== value) onChange(next);
  };

  const getPillBounds = () => {
    const track = trackRef.current;
    const pill = pillRef.current;
    if (!track || !pill) return null;
    const padding = 3;
    const trackRect = track.getBoundingClientRect();
    const pillWidth = pill.offsetWidth;
    const minLeft = padding;
    const maxLeft = trackRect.width - pillWidth - padding;
    const midLeft = (minLeft + maxLeft) / 2;
    return { minLeft, maxLeft, midLeft };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const pill = pillRef.current;
    if (!track || !pill) return;
    const pillRect = pill.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const currentLeft = pillRect.left - trackRect.left;
    const isPillTarget = pill.contains(e.target as Node);
    dragStartRef.current = {
      mouseX: e.clientX,
      pillLeft: currentLeft,
      moved: false,
      mode: isPillTarget ? "pill" : "bg",
    };
    track.setPointerCapture(e.pointerId);
    setPressMode(isPillTarget ? "pill" : "bg");
    if (isPillTarget) setDragLeft(currentLeft);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.mode !== "pill") return;
    const bounds = getPillBounds();
    if (!bounds) return;
    const delta = e.clientX - start.mouseX;
    const next = Math.max(bounds.minLeft, Math.min(bounds.maxLeft, start.pillLeft + delta));
    if (Math.abs(delta) > 2) start.moved = true;
    setDragLeft(next);

    const pillWidth = pillRef.current?.offsetWidth ?? 0;
    const pillCenter = next + pillWidth / 2;
    const trackCenter = bounds.minLeft + (bounds.maxLeft - bounds.minLeft + pillWidth) / 2;
    const nextVisual = pillCenter > trackCenter;
    if (nextVisual !== visualOn) setVisualOn(nextVisual);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const track = trackRef.current;
    if (track && track.hasPointerCapture(e.pointerId)) {
      track.releasePointerCapture(e.pointerId);
    }
    if (start) {
      if (start.mode === "pill" && start.moved && dragLeft !== null) {
        // Drag committed — commit based on release position
        const bounds = getPillBounds();
        if (bounds) commit(dragLeft > bounds.midLeft);
      } else {
        // Tap (pill or bg) — guaranteed toggle
        commit(!value);
      }
    }
    dragStartRef.current = null;
    setDragLeft(null);
    setPressMode("none");
  };

  return (
    <div
      ref={trackRef}
      className="ui-switch"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={value}
      data-mode={visualOn ? "on" : "off"}
      data-press={pressMode !== "none" ? pressMode : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        ref={pillRef}
        className={`ui-switch-pill${dragLeft !== null ? " ui-switch-pill--dragging" : ""}`}
        aria-hidden="true"
        style={dragLeft !== null ? { left: `${dragLeft}px` } : undefined}
      >
        <div className="ui-switch-pill-inner">
          <div className="ui-switch-pill-sharp-wrap">
            <div ref={sharpIconsRef} className="ui-switch-pill-icons">
              <span>{offIcon ?? <SwitchXIcon />}</span>
              <span>{onIcon ?? <SwitchCheckIcon />}</span>
            </div>
          </div>
          <div className="ui-switch-pill-blur-overlay" aria-hidden="true">
            <div ref={blurredIconsRef} className="ui-switch-pill-icons ui-switch-pill-icons--blurred">
              <span>{offIcon ?? <SwitchXIcon />}</span>
              <span>{onIcon ?? <SwitchCheckIcon />}</span>
            </div>
          </div>
        </div>
      </div>
      {/* Cells are purely visual — the track-level onClick handles all taps */}
      <div className="ui-switch-cell" aria-hidden="true">
        {offIcon ?? <SwitchXIcon />}
      </div>
      <div className="ui-switch-cell" aria-hidden="true">
        {onIcon ?? <SwitchCheckIcon />}
      </div>
    </div>
  );
}

function SwitchXIcon() {
  return <X size={16} strokeWidth={3} />;
}

function SwitchCheckIcon() {
  return <Check size={16} strokeWidth={3} />;
}
