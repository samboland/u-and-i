"use client";

import { type CSSProperties, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <LinkText />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.19 (pending). Inline link with raised text styling.
// Uses the standard text-float shadow for depth, with a subtle underline
// and blue accent on hover.
//
// variant="subtle" — for links embedded inside styled containers (pills,
// divots, display labels) that already carry their own rest-state chrome.
// At rest: no underline, no external icon, color/weight/shadow inherit
// from the container. On hover: underline + blue highlight activate.

interface LinkTextProps {
  href: string;
  children: ReactNode;
  external?: boolean;
  /** Rest-state opacity (0–1). Hover always restores full opacity. */
  dim?: number;
  /** "default" shows underline + external icon at rest. "subtle" strips
   *  rest chrome and only activates underline/color on hover. */
  variant?: "default" | "subtle";
  /** Additional inline styles — used by styled containers (pills, divots)
   *  to apply their rest appearance to the anchor itself so the whole
   *  shape stays clickable. */
  style?: CSSProperties;
  className?: string;
}

export function LinkText({
  href,
  children,
  external,
  dim,
  variant = "default",
  style,
  className,
}: LinkTextProps) {
  const classes = [
    "ui-link",
    dim != null ? "ui-link--dim" : null,
    variant === "subtle" ? "ui-link--subtle" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");
  const mergedStyle: CSSProperties = {
    ...(dim != null ? ({ "--link-dim": dim } as CSSProperties) : {}),
    ...(style ?? {}),
  };
  const showExternalIcon = external && variant !== "subtle";

  return (
    <a
      className={classes}
      href={href}
      style={Object.keys(mergedStyle).length > 0 ? mergedStyle : undefined}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
      {showExternalIcon && (
        <svg className="ui-link-external" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M15 2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V4.414l-9.293 9.293a1 1 0 0 1-1.414-1.414L19.586 3H16a1 1 0 0 1-1-1ZM5 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V7h5a1 1 0 1 0 0-2H5Z" />
        </svg>
      )}
    </a>
  );
}
