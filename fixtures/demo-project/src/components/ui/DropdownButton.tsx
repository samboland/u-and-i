"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { DropdownMenu, type MenuItemDef } from "./DropdownMenu";

// ---------------------------------------------------------------------------
// <DropdownButton />
// ---------------------------------------------------------------------------
// Primary button with a chevron that opens a DropdownMenu below it on click.
// The button reuses the .ui-btn / .ui-btn-wrap shading; the chevron rotates
// 180deg when open and the menu positions absolutely beneath.

interface DropdownButtonProps {
  label: string;
  /** Optional leading icon rendered before the label. */
  icon?: ReactNode;
  /** Icon well variant for the leading icon. Default: none (inline). */
  iconWellVariant?: "recess" | "card" | "bulge";
  /** Icon well size in px. Default: 24. */
  iconWellSize?: number;
  /** Icon well variant for the chevron. Default: none (inline). */
  chevronWellVariant?: "recess" | "card" | "bulge";
  /** Chevron well size in px. Default: 24. */
  chevronWellSize?: number;
  items: MenuItemDef[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  /** Minimum width for the button (and therefore the menu). Use to
   *  guarantee the widest menu entry fits without truncating. */
  minWidth?: number | string;
  /** Omit the chevron entirely (icon + label only trigger). The menu
   *  still opens on click; this just hides the arrow affordance. */
  hideChevron?: boolean;
  /** Optional inline style for the label span (font-size, weight, etc.). */
  labelStyle?: CSSProperties;
  /** Override the menu's min-width (default is the button width). When
   *  set, the menu is also re-centered horizontally under the button
   *  so it can extend past both edges rather than left-anchored. */
  menuMinWidth?: number | string;
  /**
   * A control that reads as sitting INSIDE the trigger, before the chevron.
   *
   * ⚠️ It is rendered as a SIBLING of the button and positioned over it, not
   * as a child — a `<button>` inside a `<button>` is invalid HTML, and browsers
   * un-nest it, which breaks both hit-testing and the accessibility tree. The
   * consumer owns the offset that clears the chevron.
   *
   * The trigger needs trailing room for it; the consumer owns that too, since
   * only it knows the control's width.
   */
  trailingControl?: ReactNode;
  /** Notified whenever the menu opens or closes, so a consumer can tear down
   *  state that only makes sense while it is open. */
  onOpenChange?: (open: boolean) => void;
}

export function DropdownButton({ label, icon, iconWellVariant, iconWellSize = 24, chevronWellVariant, chevronWellSize = 24, items, onSelect, disabled, minWidth, hideChevron, labelStyle, menuMinWidth, trailingControl, onOpenChange }: DropdownButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Report open/close as an effect rather than from the click handlers, so a
  // close driven by outside-click or Escape is announced too — those are the
  // paths a consumer tearing down dependent state most needs to hear about.
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  useEffect(() => {
    notify.current?.(open);
  }, [open]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div
      ref={wrapRef}
      className="ui-btn-wrap ui-dropdown-button-wrap"
      style={minWidth !== undefined ? { minWidth } : undefined}
    >
      <button
        type="button"
        className="ui-btn ui-dropdown-button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon && (
          iconWellVariant
            ? <span className={`ui-iconwell ui-iconwell--${iconWellVariant}`} style={{ "--ui-iconwell-size": `${iconWellSize}px` } as CSSProperties}>{icon}</span>
            : <span className="ui-dropdown-button-icon" aria-hidden="true">{icon}</span>
        )}
        <span className="ui-btn-label" style={labelStyle}>{label}</span>
        {hideChevron ? null : chevronWellVariant ? (
          <span className="ui-dropdown-button-chevron-wrap">
            <span className={`ui-iconwell ui-iconwell--${chevronWellVariant}`} style={{ "--ui-iconwell-size": `${chevronWellSize}px` } as CSSProperties}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </span>
        ) : (
          <span className="ui-dropdown-button-chevron" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        )}
      </button>
      {trailingControl ? (
        <span className="ui-dropdown-button-trailing">{trailingControl}</span>
      ) : null}
      {open ? (
        <div
          className="ui-dropdown-button-menu"
          style={menuMinWidth
            ? {
                minWidth: typeof menuMinWidth === "number" ? `${menuMinWidth}px` : menuMinWidth,
                left: "50%",
                right: "auto",
                transform: "translateX(-50%)",
              }
            : undefined}
        >
          <DropdownMenu items={items} onSelect={handleSelect} />
        </div>
      ) : null}
    </div>
  );
}
