"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <PressWell /> — the press-to-recess treatment
// ---------------------------------------------------------------------------
// The shading that plays when a small round control is pressed: its outer
// shadow stack is replaced by an inset one, so the control sinks INTO the
// surface rather than dimming or shrinking on it.
//
// ⚠️ It exists as its own component because it was the best-looking press in the
// library and it was attached to the wrong thing (Sam, 2026-08-05: "make it so
// the info icon is not pressable — stash the animation as a separate component
// though, because it looks good"). `InfoHint` carried it, and an ⓘ that presses
// promises an action it does not have: it opens a tooltip on hover and focus,
// and clicking it does nothing. The animation is worth keeping; the affordance
// was a lie.
//
// ⛔ Do NOT wrap something non-interactive in this. The whole point of the
// extraction is that the treatment now signals "this responds to a press" and
// nothing else should claim that. If a control needs the look but not the
// behaviour, it needs a different look.
//
// Composes rather than renders a control: put it around whatever element is
// already the button, so focus, keyboard handling and semantics stay where they
// belong.

interface PressWellProps {
  children: ReactNode;
  /** Match the wrapped control's radius so the recess lands on its edges. */
  round?: boolean;
}

export function PressWell({ children, round = true }: PressWellProps) {
  return (
    <span className={`ui-press-well${round ? " ui-press-well--round" : ""}`}>
      {children}
    </span>
  );
}
