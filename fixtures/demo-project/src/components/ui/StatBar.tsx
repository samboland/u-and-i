"use client";

// ---------------------------------------------------------------------------
// <StatBar />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.14 (pending). Horizontal meter with a concave trough
// track and a convex fill segment. The fill uses the button surface
// gradient so it reads as the same raised material sitting inside the
// depression. Supports a label above and a value readout to the right.

interface StatBarProps {
  label: string;
  /** 0–100. Clamped internally. Ignored when `unlimited`. */
  value?: number;
  /** Optional formatted value text (e.g. "72%", "4.2/5"). Defaults to `${value}%`. */
  displayValue?: string;
  /** Track height in px. Defaults to 10. */
  height?: number;
  /** Optional accent color for the fill. Defaults to the button surface gradient. */
  color?: string;
  /**
   * No ceiling exists for this measure — renders a FULL track with an infinity
   * glyph centred on it (Sam, 2026-08-05).
   *
   * ⚠️ It is a real state, not a styling choice, and it exists so an unbounded row
   * still reads as a METER. The alternative shipped once: a bare "0 active" line
   * beside a barred row, which Sam called off-putting — two formats in one rail
   * make the reader work out whether the difference means something.
   *
   * ⛔ Do NOT use it to paper over a limit that merely hasn't been decided yet.
   * "Unbounded" and "we haven't set the number" are different claims, and a full
   * bar asserts the first.
   */
  unlimited?: boolean;
  /**
   * Run a DOT LEADER between the label and the value — `Alerts……1 of 160`.
   *
   * The §3.22 "Spec" treatment, promoted out of the playground where it existed
   * only as inline styles. It earns its place on a stacked list of label/value
   * rows: without it the eye has to travel an empty gap and re-find its line, and
   * the gap's width changes per row, so nothing lines up to follow.
   *
   * ⚠️ Opt-in rather than default. `StatBar` is used with an EMPTY label elsewhere
   * (`taxonomy-browser`), where a leader would draw a rule from nothing to the
   * value. Existing callers keep the plain `space-between` header.
   */
  leader?: boolean;
}

export function StatBar({
  label,
  value = 0,
  displayValue,
  height = 10,
  color,
  unlimited,
  leader,
}: StatBarProps) {
  const clamped = unlimited ? 100 : Math.max(0, Math.min(100, value));
  const display = displayValue ?? (unlimited ? "∞" : `${Math.round(clamped)}%`);

  return (
    <div className="ui-statbar">
      <div className={`ui-statbar-header${leader ? " ui-statbar-header--leader" : ""}`}>
        <span className="ui-statbar-label">{label}</span>
        {/* The leader itself is a border, not characters — real dots would be
            selectable, read aloud, and would not sub-pixel align across rows. */}
        {leader ? <span className="ui-statbar-leader" aria-hidden="true" /> : null}
        <span className="ui-statbar-value">{display}</span>
      </div>
      <div
        className={`ui-statbar-track${unlimited ? " ui-statbar-track--unlimited" : ""}`}
        // ⚠️ An unbounded row is NOT a meter, and the track goes decorative rather
        // than keeping the role. ARIA requires `aria-valuenow` on `meter`, and every
        // value that could satisfy it here is a lie: 100 announces "full", which is
        // the opposite of what a full track means when the ceiling is absent, and
        // there is no max to measure a real count against. The row's meaning is
        // already in its header text ("Trips  2 of ∞"), which is read normally — so
        // hiding the bar costs nothing and asserts nothing false.
        {...(unlimited
          ? { "aria-hidden": true as const }
          : {
              role: "meter" as const,
              "aria-label": label,
              "aria-valuenow": clamped,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
            })}
        style={{ height }}
      >
        <div
          className="ui-statbar-fill"
          style={{
            width: `${clamped}%`,
            ...(color ? { backgroundColor: color } : {}),
          }}
        />
        {unlimited ? (
          <span className="ui-statbar-infinity" aria-hidden="true">
            ∞
          </span>
        ) : null}
      </div>
    </div>
  );
}
