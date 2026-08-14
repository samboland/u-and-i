"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// <Navbar />
// ---------------------------------------------------------------------------
// Vertical sidebar nav — card-surfaced column. Contains nav items that use
// the inset-preview hover pattern. Active item gets the convex surface.

interface NavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Push this item to the bottom via margin-top: auto. */
  pinBottom?: boolean;
}

interface NavbarProps {
  items: NavItem[];
  value: string;
  onChange: (id: string) => void;
  /** Strip the card surface so a parent element provides it. */
  bare?: boolean;
  /**
   * Hide labels, show only icons as square pills. Accepted for caller
   * compatibility but no longer wired to a React-driven className: the
   * label collapse is a PRIMITIVE-only feature now — the app shell's rail
   * never collapses (Epic 4.5 item 1); this prop survives for /dev/ui demos
   * in CSS so SSR + first client render produce identical markup
   * (avoids the hydration mismatch on the layout shell).
   */
  collapsed?: boolean;
  /** Allow item labels to wrap to multiple lines instead of truncating. */
  wrap?: boolean;
}

export function Navbar({ items, value, onChange, bare, wrap }: NavbarProps) {
  const n = items.length;
  const valueIndex = Math.max(0, items.findIndex((i) => i.id === value));
  const [visualIndex, setVisualIndex] = useState(valueIndex);
  const [isPressed, setIsPressed] = useState(false);
  const [dragTop, setDragTop] = useState<number | null>(null);
  const [dragPillHeight, setDragPillHeight] = useState(36);
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const sharpLabelsRef = useRef<HTMLDivElement>(null);
  const blurredLabelsRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseY: number; pillTop: number; moved: boolean } | null>(null);
  // Cached metrics ref written in layout effects, read only during drag events.
  const metricsRef = useRef<{ top: number; height: number }[]>([]);
  const mountedRef = useRef(false);
  // When a click triggers onChange, the external value (e.g. pathname)
  // may not update until the next page loads. Don't snap the pill back
  // to the old valueIndex during that transition.
  const [pendingClick, setPendingClick] = useState(false);

  const [prevValueIndex, setPrevValueIndex] = useState(valueIndex);
  if (valueIndex !== prevValueIndex) {
    setPrevValueIndex(valueIndex);
    if (dragTop === null && !pendingClick) {
      setVisualIndex(valueIndex);
    }
  }
  if (valueIndex === visualIndex && pendingClick) {
    setPendingClick(false);
  }

  const padding = 6;

  const getItemMetrics = () => {
    const nav = navRef.current;
    if (!nav) return null;
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>(".ui-navbar-item"));
    const navRect = nav.getBoundingClientRect();
    return buttons.map((btn) => {
      const r = btn.getBoundingClientRect();
      return { top: r.top - navRect.top, height: r.height };
    });
  };

  // Sync pill position via direct DOM writes (avoids setState-in-effect lint).
  useLayoutEffect(() => {
    const metrics = getItemMetrics();
    if (metrics) metricsRef.current = metrics;
    const pill = pillRef.current;
    const m = metrics?.[visualIndex];
    if (pill && m && dragTop === null) {
      // On first render, skip the CSS transition so the pill
      // starts at the correct position instantly (no slide from 0).
      if (!mountedRef.current) {
        pill.style.transition = "none";
        pill.style.top = `${m.top}px`;
        pill.style.height = `${m.height}px`;
        // Force layout, then re-enable transition
        void pill.offsetHeight;
        pill.style.transition = "";
        mountedRef.current = true;
      } else {
        pill.style.top = `${m.top}px`;
        pill.style.height = `${m.height}px`;
      }
    }
  });

  // Position the label layers inside the pill — vertical version of Toggle logic.
  // Use the TARGET pill position (stable button metrics), not the animated
  // pill position, so the label's CSS transition stays in sync with the pill's
  // CSS transition instead of chasing it.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const metrics = getItemMetrics();
    if (!metrics) return;
    const navHeight = nav.offsetHeight;
    const innerHeight = navHeight - padding * 2;
    const targetPillTop = dragTop !== null
      ? dragTop
      : metrics[visualIndex]?.top ?? padding;
    const topValue = `${padding - targetPillTop}px`;
    const heightValue = `${innerHeight}px`;
    if (sharpLabelsRef.current) {
      sharpLabelsRef.current.style.top = topValue;
      sharpLabelsRef.current.style.height = heightValue;
    }
    if (blurredLabelsRef.current) {
      blurredLabelsRef.current.style.top = topValue;
      blurredLabelsRef.current.style.height = heightValue;
    }
    // Sync pill label gaps to match any margin-top:auto gaps on buttons.
    // Each pill label gets the same marginTop as its corresponding button.
    const syncLabelGaps = (container: HTMLDivElement | null) => {
      if (!container || metrics.length < 2) return;
      const labels = Array.from(container.children) as HTMLElement[];
      for (let i = 1; i < labels.length && i < metrics.length; i++) {
        // Gap = actual button top - expected top (previous bottom)
        const expectedTop = metrics[i - 1]!.top + metrics[i - 1]!.height;
        const actualGap = metrics[i]!.top - expectedTop;
        // Navbar default gap is 4px
        const extraGap = Math.max(0, actualGap - 4);
        labels[i]!.style.marginTop = extraGap > 0 ? `${extraGap}px` : "";
      }
    };
    syncLabelGaps(sharpLabelsRef.current);
    syncLabelGaps(blurredLabelsRef.current);
  });

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pill = pillRef.current;
    if (!pill) return;
    const navRect = navRef.current!.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const currentTop = pillRect.top - navRect.top;
    dragStartRef.current = { mouseY: e.clientY, pillTop: currentTop, moved: false };
    const metrics = metricsRef.current;
    setDragPillHeight(metrics[visualIndex]?.height ?? 36);
    pill.setPointerCapture(e.pointerId);
    setDragTop(currentTop);
    setIsPressed(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const metrics = getItemMetrics();
    if (!metrics) return;
    const delta = e.clientY - dragStartRef.current.mouseY;
    const minTop = metrics[0]?.top ?? padding;
    const lastM = metrics[n - 1];
    const maxTop = lastM ? lastM.top : padding;
    const next = Math.max(minTop, Math.min(maxTop, dragStartRef.current.pillTop + delta));
    if (Math.abs(delta) > 2) dragStartRef.current.moved = true;
    setDragTop(next);

    const pillHeight = metrics[visualIndex]?.height ?? 36;
    const pillCenter = next + pillHeight / 2;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const m = metrics[i];
      if (m && pillCenter >= m.top && pillCenter < m.top + m.height) { idx = i; break; }
      if (m && pillCenter >= m.top) idx = i;
    }
    if (idx !== visualIndex) setVisualIndex(idx);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const pill = pillRef.current;
    if (pill && pill.hasPointerCapture(e.pointerId)) {
      pill.releasePointerCapture(e.pointerId);
    }
    // The pill captures pointerdown so it can drag, which steals click
    // events from the underlying active button. Fire onChange on every
    // release so a plain click on the pill still navigates (matching
    // the inactive-button click path).
    if (start) {
      const item = items[visualIndex];
      if (item) {
        setPendingClick(true);
        onChange(item.id);
      }
    }
    dragStartRef.current = null;
    setDragTop(null);
    setIsPressed(false);
  };

  return (
    <nav
      ref={navRef}
      className={`ui-navbar${bare ? " ui-navbar--bare" : ""}${wrap ? " ui-navbar--wrap" : ""}`}
      data-pressed={isPressed ? "true" : undefined}
    >
      <div
        ref={pillRef}
        className={`ui-navbar-pill${dragTop !== null ? " ui-navbar-pill--dragging" : ""}`}
        aria-hidden="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={dragTop !== null ? { top: dragTop, height: dragPillHeight } : { top: padding, height: 36 }}
      >
        <div className="ui-navbar-pill-inner">
          <div className="ui-navbar-pill-sharp-wrap">
            <div ref={sharpLabelsRef} className="ui-navbar-pill-labels">
              {items.map((item) => (
                <div key={item.id} className="ui-navbar-pill-label">
                  {item.icon ? <span className="ui-navbar-item-icon">{item.icon}</span> : null}
                  <span className="ui-navbar-item-label">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ui-navbar-pill-blur-overlay" aria-hidden="true">
            <div ref={blurredLabelsRef} className="ui-navbar-pill-labels ui-navbar-pill-labels--blurred">
              {items.map((item) => (
                <div key={item.id} className="ui-navbar-pill-label">
                  {item.icon ? <span className="ui-navbar-item-icon">{item.icon}</span> : null}
                  <span className="ui-navbar-item-label">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {items.map((item, i) => {
        // Only the FIRST item flagged pinBottom takes margin-top:auto.
        // Subsequent pin-bottom items cluster directly beneath it
        // instead of each grabbing their own slice of leftover space
        // (which would float them apart in the middle of the column).
        const isFirstPinBottom =
          item.pinBottom && !items.slice(0, i).some((prev) => prev.pinBottom);
        return (
        <button
          key={item.id}
          type="button"
          className={`ui-navbar-item${i === visualIndex ? " ui-navbar-item--active" : ""}`}
          style={isFirstPinBottom ? { marginTop: "auto" } : undefined}
          onClick={() => {
            setVisualIndex(i);
            setPendingClick(true);
            onChange(item.id);
          }}
        >
          {item.icon ? <span className="ui-navbar-item-icon">{item.icon}</span> : null}
          <span className="ui-navbar-item-label">{item.label}</span>
        </button>
        );
      })}
    </nav>
  );
}
