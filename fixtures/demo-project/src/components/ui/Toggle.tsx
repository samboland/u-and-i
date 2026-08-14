"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

// ---------------------------------------------------------------------------
// <Toggle />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.2. Two-option sliding-pill toggle. Drag-to-select via
// pointer capture, progressive rim blur, window-through text (dark text
// inside pill + faint text on buttons behind), visual-mode tracks pill
// position live during drag.

interface ToggleOption {
  id: string;
  label: string;
}

interface ToggleProps {
  options: [ToggleOption, ToggleOption];
  value: string;
  onChange: (id: string) => void;
}

export function Toggle({ options, value, onChange }: ToggleProps) {
  // `visualMode` tracks pill position for live text darkening. On drag
  // release (or click), it's synced with the committed value via onChange.
  const [visualValue, setVisualValue] = useState<string>(value);
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [isPressed, setIsPressed] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const sharpLabelsRef = useRef<HTMLDivElement>(null);
  const blurredLabelsRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseX: number; pillLeft: number; moved: boolean } | null>(null);

  // Keep visualValue in sync when the committed value changes externally
  // (e.g., on drag release or click).
  if (dragLeft === null && visualValue !== value) {
    setVisualValue(value);
  }

  const leftIndex = options[0].id;
  const visualIsLeft = visualValue === leftIndex;

  // Layout effect mirrors the provider-buttons one: computes pill-relative
  // offsets for the labels layers so they sit at fixed track X positions.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const pill = pillRef.current;
    if (!track || !pill) return;
    const padding = 3;
    const trackWidth = track.offsetWidth;
    const innerWidth = trackWidth - padding * 2;
    const pillLeft =
      dragLeft !== null
        ? dragLeft
        : visualIsLeft
          ? padding
          : trackWidth / 2 + 3;
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

  const commit = (next: string) => {
    setVisualValue(next);
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
    const pill = pillRef.current;
    if (!pill) return;
    const bounds = getPillBounds();
    if (!bounds) return;
    const pillRect = pill.getBoundingClientRect();
    const trackRect = trackRef.current!.getBoundingClientRect();
    const currentLeft = pillRect.left - trackRect.left;
    dragStartRef.current = { mouseX: e.clientX, pillLeft: currentLeft, moved: false };
    pill.setPointerCapture(e.pointerId);
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

    const pillWidth = pillRef.current?.offsetWidth ?? 0;
    const pillCenter = next + pillWidth / 2;
    const trackCenter = bounds.minLeft + (bounds.maxLeft - bounds.minLeft + pillWidth) / 2;
    const nextVisual = pillCenter > trackCenter ? options[1].id : options[0].id;
    if (nextVisual !== visualValue) setVisualValue(nextVisual);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const pill = pillRef.current;
    if (pill && pill.hasPointerCapture(e.pointerId)) {
      pill.releasePointerCapture(e.pointerId);
    }
    if (start && start.moved && dragLeft !== null) {
      const bounds = getPillBounds();
      if (bounds) {
        commit(dragLeft > bounds.midLeft ? options[1].id : options[0].id);
      }
    }
    dragStartRef.current = null;
    setDragLeft(null);
    setIsPressed(false);
  };

  return (
    <div
      ref={trackRef}
      className="ui-toggle-track"
      role="tablist"
      data-mode={visualIsLeft ? "left" : "right"}
      data-pressed={isPressed ? "true" : undefined}
    >
      <div
        ref={pillRef}
        className={`ui-toggle-pill${dragLeft !== null ? " ui-toggle-pill--dragging" : ""}`}
        aria-hidden="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={dragLeft !== null ? { left: `${dragLeft}px` } : undefined}
      >
        <div className="ui-toggle-pill-inner">
          <div className="ui-toggle-pill-sharp-wrap">
            <div ref={sharpLabelsRef} className="ui-toggle-pill-labels">
              <span>{options[0].label}</span>
              <span>{options[1].label}</span>
            </div>
          </div>
          <div className="ui-toggle-pill-blur-overlay" aria-hidden="true">
            <div
              ref={blurredLabelsRef}
              className="ui-toggle-pill-labels ui-toggle-pill-labels--blurred"
            >
              <span>{options[0].label}</span>
              <span>{options[1].label}</span>
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        role="tab"
        aria-selected={value === options[0].id}
        className="ui-toggle-tab"
        onClick={() => commit(options[0].id)}
      >
        {options[0].label}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === options[1].id}
        className="ui-toggle-tab"
        onClick={() => commit(options[1].id)}
      >
        {options[1].label}
      </button>
    </div>
  );
}
