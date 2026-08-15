"use client";

import { useState, type ReactNode } from "react";
import { IconButton } from "./IconButton";

// ---------------------------------------------------------------------------
// <ProConCard />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.18 (pending). Expandable/collapsible card for pro/con
// items. Collapsed shows the headline + type indicator. Expanded reveals
// source quotes and attribution. Uses Card surface with a colored left
// accent edge. Expand/collapse uses an IconButton (§3.3).

interface Quote {
  text: string;
  source: string;
}

interface ProConCardProps {
  type: "pro" | "con";
  text: string;
  quotes?: Quote[];
  /** Optional trailing content in the always-visible header row
   *  (contested badge, vote buttons). Rendered between the text
   *  and the expand chevron. */
  headerExtras?: ReactNode;
  /** Optional trailing content in the body (always-visible source
   *  attribution row, extra metadata, etc.). Renders above the
   *  quotes when the card is expanded. */
  children?: ReactNode;
  defaultOpen?: boolean;
}

function ChevronIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.293 8.293a1 1 0 0 1 1.414 0L12 13.586l5.293-5.293a1 1 0 1 1 1.414 1.414l-6 6a1 1 0 0 1-1.414 0l-6-6a1 1 0 0 1 0-1.414Z" />
    </svg>
  );
}

export function ProConCard({
  type,
  text,
  quotes,
  headerExtras,
  children,
  defaultOpen = false,
}: ProConCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasContent = (quotes && quotes.length > 0) || children;

  return (
    <div
      className="ui-procon"
      data-type={type}
      data-open={open || undefined}
    >
      <div
        className="ui-procon-header"
        role="button"
        tabIndex={hasContent ? 0 : undefined}
        onClick={() => hasContent && setOpen(!open)}
        onKeyDown={(e) => {
          if (hasContent && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        aria-expanded={hasContent ? open : undefined}
        style={hasContent ? { cursor: "pointer" } : undefined}
      >
        <span className="ui-procon-indicator" aria-hidden="true">
          {type === "pro" ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13.75 5a1.75 1.75 0 1 0-3.5 0v5.25H5a1.75 1.75 0 1 0 0 3.5h5.25V19a1.75 1.75 0 1 0 3.5 0v-5.25H19a1.75 1.75 0 1 0 0-3.5h-5.25V5Z" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3.25" y="10.25" width="17.5" height="3.5" rx="1.75" /></svg>
          )}
        </span>
        <span className="ui-procon-text">{text}</span>
        {headerExtras && (
          <span
            className="ui-procon-header-extras"
            onClick={(e) => e.stopPropagation()}
          >
            {headerExtras}
          </span>
        )}
        {hasContent && (
          <span className="ui-procon-chevron-wrap">
            <IconButton
              size={28}
              label={open ? "Collapse" : "Expand"}
              onClick={(e) => {
                e?.stopPropagation();
                setOpen(!open);
              }}
            >
              <ChevronIcon />
            </IconButton>
          </span>
        )}
      </div>

      {open && hasContent && (
        <div className="ui-procon-body">
          {children && <div className="ui-procon-extra">{children}</div>}
          {quotes && quotes.length > 0 && (
            <div className="ui-procon-quotes">
              {quotes.map((q, i) => (
                <blockquote key={i} className="ui-procon-quote">
                  <p>&ldquo;{q.text}&rdquo;</p>
                  <cite>— {q.source}</cite>
                </blockquote>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
