"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// <IconButton />
// ---------------------------------------------------------------------------
// Small clickable icon — button-shaded convex well with hover/press states
// and blue glow. Use for interactive icon actions (close, settings, etc).
//
// Icon swaps: pass `iconKey` whenever the visible icon changes and
// IconButton will crossfade the outgoing icon out and the incoming icon
// in (scale + rotate + opacity). Leave `iconKey` undefined for the
// original snap-without-animation behavior.
//
// Change detection runs *during render* via setState-during-render so
// React discards the intermediate render and commits directly to the
// frame where both slots carry their animation classes. Without that,
// the browser would paint the new icon at its resting state for one
// frame before the --in class was added, producing a visible rubber-
// band snap-to-start at the beginning of the fade-in.
//
// Aside label: pass `asideLabel` to render a short text label beside
// the button (e.g. "Copied"). It fades in when set to a non-empty
// string and fades out when cleared (null/undefined/empty). The last
// string value is retained across the fade-out so the label text
// stays legible while it's animating away. aria-live="polite"
// announces the label to screen readers.

interface IconButtonProps {
  children: ReactNode;
  size?: number;
  disabled?: boolean;
  onClick?: (e?: React.MouseEvent) => void;
  label?: string;
  /**
   * Stable discriminator for the current icon (e.g. "copy" / "check").
   * When it changes, IconButton crossfades between the previous and new
   * icon. Omit entirely if the icon never changes.
   */
  iconKey?: string | number;
  /**
   * Short text label that appears beside the button, fading in when
   * set and fading out when cleared. Ideal for transient feedback
   * such as "Copied", "Saved", "Applied". Set to null/undefined/""
   * to hide.
   */
  asideLabel?: string | null;
  /**
   * Optional popover content rendered inside the button's `.ui-btn-wrap`
   * so it inherits the press transform (matches DropdownButton's menu
   * behavior — the popover "follows" the button's translate-on-press).
   * Typically an absolutely-positioned dropdown card; caller controls
   * open/close.
   */
  popover?: ReactNode;
  /**
   * Forward `suppressHydrationWarning` to the inner `<button>`. Use only
   * when the button's visible state (icon, aria-label) depends on client
   * state that can't be known during SSR — e.g. localStorage-driven
   * sidebar collapse. Leave undefined otherwise.
   */
  suppressHydrationWarning?: boolean;
}

const SWAP_MS = 180;
// Margin past the CSS animation duration so the out slot unmounts after
// the keyframes finish, avoiding a race where React drops the --out
// class mid-animation and snaps the element to its base style.
const SWAP_CLEAR_MS = SWAP_MS + 60;

export function IconButton({
  children,
  size = 36,
  disabled,
  onClick,
  label,
  iconKey,
  asideLabel,
  popover,
  suppressHydrationWarning,
}: IconButtonProps) {
  // Snapshot tracks the last-committed key + children so render-time
  // change detection can capture the outgoing icon without reading a ref.
  const [snapshot, setSnapshot] = useState({ key: iconKey, children });
  const [outgoing, setOutgoing] = useState<ReactNode>(null);
  // Keep the most recent non-empty asideLabel around even after the
  // caller clears it, so the fade-out animation has visible text to
  // render. Initialized from the first-render value so SSR markup
  // matches the client hydration pass.
  const initialAside = asideLabel && asideLabel.length > 0 ? asideLabel : null;
  const [persistedAside, setPersistedAside] = useState<string | null>(initialAside);

  // Render-time change detection. Calling setState during render makes
  // React discard the current render tree and immediately re-render
  // with the new state BEFORE committing — so the user never sees an
  // intermediate frame where the incoming icon has mounted without its
  // --in animation class attached.
  if (iconKey !== undefined && iconKey !== snapshot.key) {
    setOutgoing(snapshot.children);
    setSnapshot({ key: iconKey, children });
  }

  // Schedule removal of the outgoing pane once the swap animation has
  // finished. Keyed on `outgoing` so each new swap gets its own timer,
  // and previous timers are cleaned up if outgoing changes mid-flight.
  useEffect(() => {
    if (outgoing == null) return;
    const t = window.setTimeout(() => setOutgoing(null), SWAP_CLEAR_MS);
    return () => window.clearTimeout(t);
  }, [outgoing]);

  // Latch the most recent non-empty asideLabel so the fade-out
  // animation has visible text. Derived during render — when the caller
  // clears asideLabel we deliberately keep the old value.
  if (asideLabel && asideLabel.length > 0 && asideLabel !== persistedAside) {
    setPersistedAside(asideLabel);
  }

  const animating = outgoing != null;
  const asideVisible = !!(asideLabel && asideLabel.length > 0);
  // Only wrap in the root container once an aside has been used; if
  // asideLabel has never been set, return the original DOM exactly so
  // existing callers (DropdownButton, AppBar, etc.) are untouched.
  const hasAsideSlot = persistedAside != null;

  const buttonWrap = (
    <span className="ui-btn-wrap" style={{ alignSelf: "auto" }}>
      <button
        type="button"
        className="ui-iconbtn"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        style={{ "--ui-iconwell-size": `${size}px` } as CSSProperties}
        suppressHydrationWarning={suppressHydrationWarning}
      >
        {iconKey === undefined ? (
          // No discriminator → preserve the original zero-wrapper DOM
          // for callers that never swap icons.
          children
        ) : (
          <span className="ui-iconbtn-stack">
            {animating && (
              <span
                className="ui-iconbtn-slot ui-iconbtn-slot--out"
                aria-hidden="true"
              >
                {outgoing}
              </span>
            )}
            <span
              key={String(iconKey)}
              className={`ui-iconbtn-slot${animating ? " ui-iconbtn-slot--in" : ""}`}
            >
              {children}
            </span>
          </span>
        )}
      </button>
      {popover}
    </span>
  );

  if (!hasAsideSlot) {
    // No aside ever requested — return the original DOM shape so
    // existing callers are byte-for-byte unchanged.
    return buttonWrap;
  }

  return (
    <span className="ui-iconbtn-root">
      {buttonWrap}
      <span
        className={`ui-iconbtn-aside${asideVisible ? " ui-iconbtn-aside--visible" : ""}`}
        aria-live="polite"
      >
        {persistedAside}
      </span>
    </span>
  );
}
