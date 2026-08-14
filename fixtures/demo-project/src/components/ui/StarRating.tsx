"use client";

// ---------------------------------------------------------------------------
// <StarRating />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.17 (pending). Star rating inside a single trough track
// with recess dividers between each star segment. A convex fill bar
// slides through. Two star layers — empty (under the fill) and filled
// (inside the fill, clipped by overflow:hidden) — create a clean split
// on partially-covered stars.

interface StarRatingProps {
  label: string;
  /** 0–5, supports decimals. Clamped internally. */
  value: number;
  /** Optional formatted value text (e.g. "4.2 / 5"). Defaults to value with one decimal. */
  displayValue?: string;
  /** Track height in px. Defaults to 32. */
  height?: number;
  /** Fill color. Defaults to the standard stat bar fill. */
  color?: string;
}

const STAR_COUNT = 5;

function StarShape() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 1l2.9 6.9L22 9l-5.5 4.7L18.2 21 12 17.2 5.8 21l1.7-7.3L2 9l7.1-1.1L12 1z" />
    </svg>
  );
}

export function StarRating({
  label,
  value,
  displayValue,
  height = 32,
  color,
}: StarRatingProps) {
  const clamped = Math.max(0, Math.min(5, value));
  const pct = (clamped / STAR_COUNT) * 100;
  const display = displayValue ?? clamped.toFixed(1);

  const stars = Array.from({ length: STAR_COUNT }, (_, i) => (
    <span key={i} className="ui-star-rating-star">
      <StarShape />
    </span>
  ));

  const dividers = Array.from({ length: STAR_COUNT - 1 }, (_, i) => {
    const divPos = (i + 1) / STAR_COUNT;
    const filled = (clamped / STAR_COUNT) >= divPos;
    return (
      <div
        key={`div-${i}`}
        className="ui-star-rating-divider"
        data-filled={filled || undefined}
        style={{ left: `${divPos * 100}%` }}
      />
    );
  });

  return (
    <div className="ui-star-rating">
      <div className="ui-statbar-header">
        <span className="ui-statbar-label">{label}</span>
        <span className="ui-statbar-value">{display}</span>
      </div>
      <div
        className="ui-star-rating-track"
        role="meter"
        aria-label={`${label}: ${display} out of 5 stars`}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={5}
        style={{ height }}
      >
        {/* Empty stars — visible where the fill doesn't cover */}
        <div className="ui-star-rating-stars ui-star-rating-stars--empty" aria-hidden="true">
          {stars}
        </div>

        {/* Fill bar + filled stars clipped inside it */}
        <div
          className="ui-star-rating-fill"
          style={{
            width: `${pct}%`,
            ...(color ? { backgroundColor: color } : {}),
          }}
        >
          <div
            className="ui-star-rating-stars ui-star-rating-stars--filled"
            aria-hidden="true"
            style={pct > 0 ? { width: `${(100 / pct) * 100}%` } : undefined}
          >
            {stars}
          </div>
        </div>

        {/* Dividers on top of everything */}
        {dividers}
      </div>
    </div>
  );
}
