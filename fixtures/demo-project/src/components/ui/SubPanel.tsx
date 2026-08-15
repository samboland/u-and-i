"use client";

import { type ReactNode } from "react";

import { InfoHint } from "./InfoHint";

// ---------------------------------------------------------------------------
// <SubPanel /> — §3.5c
// ---------------------------------------------------------------------------
// A row of fact plates that TUCKS UNDER the card above it. Sibling of §3.5b
// SubHeader, which tucks a single title card under the sticky site Header; this
// tucks a row of cells under an arbitrary card, and lets one of them sit raised
// and protrude further down than the rest.
//
// Same trick as SubHeader, and it is the whole component: a negative margin-top
// slides the top edge behind the element above, top corners stay square because
// they are never seen, and the cell's TOP PADDING is the tucked strip — so the
// visible content still reads as vertically centred once the hidden part is
// subtracted. Getting that padding wrong is what makes a tucked plate look like
// its text is falling out of the bottom.
//
// ⚠️ THE CONSUMER MUST REMOVE ANY GAP between this and the element above.
// SubHeader has the same contract ("the page container should have
// `padding-top: 0`"). A flex/grid `gap` is added AFTER margins collapse, so a
// parent with `gap: 1.75rem` silently eats a 1.75rem tuck and the panel lands
// flush instead — which reads as a detached bar rather than as one layer
// emerging from under another. Measured that exact failure on Home: gap 28px
// against margin −28px gave an overlap of precisely 0.
//
// ⛔ Do NOT stretch the cells to equal height. The raised cell protrudes by
// being TALLER, so `align-items: start` is load-bearing; with `stretch` every
// cell matches the tallest and the layering disappears while still looking
// plausible in code.

interface SubPanelProps {
  children: ReactNode;
  /** Accessible name for the group, when the cells need one collectively. */
  label?: string;
}

export function SubPanel({ children, label }: SubPanelProps) {
  return (
    <div className="ui-subpanel-slot">
      <div className="ui-subpanel" role={label ? "group" : undefined} aria-label={label}>
        {children}
      </div>
    </div>
  );
}

interface SubPanelCellProps {
  /** Small caps label above the value. */
  label: ReactNode;
  /** The value itself — the line a person actually reads. */
  value: ReactNode;
  /** Optional secondary line beneath the value. */
  sub?: ReactNode;
  /**
   * Raise this cell onto the card surface and let it protrude further down.
   *
   * ⚠️ At most ONE per panel. Two raised cells read as a broken row rather than
   * as emphasis, because the depth stops distinguishing anything.
   */
  raised?: boolean;
  /** Widen this cell relative to its siblings — for the one carrying prose. */
  wide?: boolean;
  /** Full text when the value is truncated (e.g. a shortened IANA zone). */
  title?: string;
  /**
   * Detail behind an ⓘ beside the VALUE — the evidence for the number the cell
   * shows. Omit when there is nothing more to say; an ⓘ that opens a restatement
   * of the visible text teaches the reader to stop pressing them.
   */
  hint?: ReactNode;
  /** Accessible name for the hint trigger. Required whenever `hint` is not a
   *  plain string, since the fallback would announce "More information". */
  hintLabel?: string;
}

export function SubPanelCell({
  label,
  value,
  sub,
  raised,
  wide,
  title,
  hint,
  hintLabel,
}: SubPanelCellProps) {
  return (
    <div
      className={`ui-subpanel-cell${raised ? " ui-subpanel-cell--raised" : ""}${
        wide ? " ui-subpanel-cell--wide" : ""
      }`}
      title={title}
    >
      <span className="ui-subpanel-label">{label}</span>
      {/* ⚠️ The hint is a SIBLING of the value, not inside it. `.ui-subpanel-value`
          carries `text-overflow: ellipsis`, which needs a block-ish box with
          `overflow: hidden` — turning it into a flex row to seat an icon kills the
          truncation that keeps a long IANA id inside its cell. */}
      <span className="ui-subpanel-valuerow">
        <span className="ui-subpanel-value">{value}</span>
        {hint ? <InfoHint label={hint} ariaLabel={hintLabel} size="xs" /> : null}
      </span>
      {sub ? <span className="ui-subpanel-sub">{sub}</span> : null}
    </div>
  );
}
