"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

// ---------------------------------------------------------------------------
// <TabBar />
// ---------------------------------------------------------------------------
// N-option sliding-pill selector. Full clone of Toggle mechanics — drag to
// select via pointer capture, window-through text, progressive rim blur —
// generalized to an arbitrary number of tabs.
//
// ⚠️⚠️ INVARIANT FOR EVERY IMPLEMENTATION (Sam, 2026-07-29):
// **A TabBar's rendered width MUST NOT depend on the content of the panel it
// controls.** When a TabBar switches between panels of differing width and its
// own width follows theirs, the control moves and resizes under the user's
// cursor as they use it. That is disorienting, and it is disorienting in the
// one place a UI can least afford it — the thing you are actively clicking.
//
// The TabBar fills its parent, so THE PARENT is what has to be stable. Two
// traps, both hit for real on /dev/ui:
//
//   1. A container with `max-width` but no `width` that is ALSO a flex item
//      with `margin: 0 auto`. Auto cross-axis margins make a flex item
//      shrink-to-fit rather than stretch, so it silently sizes from its
//      content and the max-width never engages. Add an explicit `width: 100%`.
//   2. Any ancestor that shrink-wraps (inline-block, float, grid track sized
//      `auto`, `width: fit-content`) between the TabBar and a stable width.
//
// Check it by MEASURING, not by eye: read the bar's `getBoundingClientRect()`
// on every tab and assert the width is identical. A 40px drift is obvious in
// use and easy to miss in a screenshot.

interface TabBarProps {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  /**
   * Smaller tab labels + tighter padding. Use when the TabBar lives in
   * a constrained surface (e.g. a 500px modal) and the option labels
   * are long enough to ellipsize at the default size.
   */
  compact?: boolean;
}

export function TabBar({ tabs, value, onChange, compact }: TabBarProps) {
  const n = tabs.length;
  const valueIndex = Math.max(0, tabs.findIndex((t) => t.id === value));

  const [visualIndex, setVisualIndex] = useState(valueIndex);
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [isPressed, setIsPressed] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const sharpLabelsRef = useRef<HTMLDivElement>(null);
  const blurredLabelsRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseX: number; pillLeft: number; moved: boolean } | null>(null);
  // Pill width set at drag start so render never reads a DOM ref directly.
  const [dragPillWidth, setDragPillWidth] = useState(0);

  // Sync visual index when committed value changes externally
  if (dragLeft === null && visualIndex !== valueIndex) {
    setVisualIndex(valueIndex);
  }

  const padding = 3;

  // Same proportions as Toggle: 3px track padding + 6px gap between
  // adjacent pill positions + pill flush with track padding at outer edges.
  // pillWidth = trackWidth/n - 6; pill_i_left = 3 + i * (trackWidth/n)
  const getPillLeftForIndex = (idx: number) => {
    const track = trackRef.current;
    if (!track) return padding;
    return padding + idx * (track.offsetWidth / n);
  };

  const getPillWidth = () => {
    const track = trackRef.current;
    if (!track) return 0;
    return track.offsetWidth / n - 6;
  };

  // Layout effect: position the label layers inside the pill
  useLayoutEffect(() => {
    const track = trackRef.current;
    const pill = pillRef.current;
    if (!track || !pill) return;
    const trackWidth = track.offsetWidth;
    const innerWidth = trackWidth - padding * 2;
    const pillLeft = dragLeft !== null ? dragLeft : getPillLeftForIndex(visualIndex);
    const leftValue = `${padding - pillLeft}px`;
    const widthValue = `${innerWidth}px`;
    if (sharpLabelsRef.current) {
      sharpLabelsRef.current.style.left = leftValue;
      sharpLabelsRef.current.style.width = widthValue;
    }
    if (blurredLabelsRef.current) {
      blurredLabelsRef.current.style.left = leftValue;
      blurredLabelsRef.current.style.width = widthValue;
    }
  });

  const commit = (idx: number) => {
    setVisualIndex(idx);
    const tab = tabs[idx];
    if (tab && tab.id !== value) onChange(tab.id);
  };

  const getPillBounds = () => {
    const track = trackRef.current;
    if (!track) return null;
    const trackWidth = track.offsetWidth;
    const pillWidth = getPillWidth();
    const minLeft = padding;
    const maxLeft = trackWidth - pillWidth - padding;
    return { minLeft, maxLeft, pillWidth };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pill = pillRef.current;
    if (!pill) return;
    const bounds = getPillBounds();
    if (!bounds) return;
    const pillRect = pill.getBoundingClientRect();
    const trackRect = trackRef.current!.getBoundingClientRect();
    const currentLeft = pillRect.left - trackRect.left;
    dragStartRef.current = { mouseX: e.clientX, pillLeft: currentLeft, moved: false };
    pill.setPointerCapture(e.pointerId);
    setDragPillWidth(bounds.pillWidth);
    setDragLeft(currentLeft);
    setIsPressed(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const bounds = getPillBounds();
    if (!bounds) return;
    const delta = e.clientX - dragStartRef.current.mouseX;
    const next = Math.max(bounds.minLeft, Math.min(bounds.maxLeft, dragStartRef.current.pillLeft + delta));
    if (Math.abs(delta) > 2) dragStartRef.current.moved = true;
    setDragLeft(next);

    // Determine which tab the pill center is over (cell size = trackWidth/n)
    const pillCenter = next + bounds.pillWidth / 2;
    const cellWidth = (trackRef.current?.offsetWidth ?? 0) / n;
    const idx = Math.max(0, Math.min(n - 1, Math.floor((pillCenter - padding) / cellWidth)));
    if (idx !== visualIndex) setVisualIndex(idx);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const pill = pillRef.current;
    if (pill && pill.hasPointerCapture(e.pointerId)) {
      pill.releasePointerCapture(e.pointerId);
    }
    if (start && start.moved && dragLeft !== null) {
      commit(visualIndex);
    }
    dragStartRef.current = null;
    setDragLeft(null);
    setIsPressed(false);
  };

  // Use CSS calc for non-drag state so the pill renders at the correct
  // position on first paint without depending on measured offsetWidth.
  const pillStyle: CSSProperties = dragLeft !== null
    ? { left: `${dragLeft}px`, width: `${dragPillWidth}px` }
    : {
        left: `calc(${padding}px + ${visualIndex} * 100% / ${n})`,
        width: `calc(100% / ${n} - 6px)`,
      };

  return (
    <div
      ref={trackRef}
      className={`ui-tabbar${compact ? " ui-tabbar--compact" : ""}`}
      role="tablist"
      data-pressed={isPressed ? "true" : undefined}
    >
      <div
        ref={pillRef}
        className={`ui-tabbar-pill${dragLeft !== null ? " ui-tabbar-pill--dragging" : ""}`}
        aria-hidden="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={pillStyle}
      >
        <div className="ui-toggle-pill-inner">
          <div className="ui-toggle-pill-sharp-wrap">
            <div ref={sharpLabelsRef} className="ui-toggle-pill-labels">
              {tabs.map((t) => <span key={t.id}>{t.label}</span>)}
            </div>
          </div>
          <div className="ui-toggle-pill-blur-overlay" aria-hidden="true">
            <div
              ref={blurredLabelsRef}
              className="ui-toggle-pill-labels ui-toggle-pill-labels--blurred"
            >
              {tabs.map((t) => <span key={t.id}>{t.label}</span>)}
            </div>
          </div>
        </div>
      </div>
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className="ui-tabbar-tab"
          onClick={() => commit(i)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
