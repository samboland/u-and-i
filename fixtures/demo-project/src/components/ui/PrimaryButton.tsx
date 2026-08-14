"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <PrimaryButton />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.1. Skeuomorphic stack, faint blue rim at rest, three-layer
// blue glow on hover, physical depression on press (translateY + inset shadow,
// no scale). Optional icon well on the right.

interface PrimaryButtonProps {
  label: string;
  icon?: ReactNode;
  iconWellVariant?: "recess" | "card" | "bulge";
  /** Disable the glyph drop-shadow on the icon (for multi-color SVGs). */
  iconGlow?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "default" | "sm";
  onClick?: () => void;
  /** When set, renders as an `<a>` instead of `<button>` — for downloads,
   *  external links, or any navigation-style primary action. */
  href?: string;
  /** Adds the HTML `download` attribute when rendered as an anchor. */
  download?: boolean | string;
  external?: boolean;
}

export function PrimaryButton({
  label,
  icon,
  iconWellVariant = "recess",
  iconGlow = true,
  disabled,
  fullWidth,
  size = "default",
  onClick,
  href,
  download,
  external,
}: PrimaryButtonProps) {
  const classes = [
    "ui-btn",
    !icon && "ui-btn--no-icon",
    size === "sm" && "ui-btn--sm",
  ].filter(Boolean).join(" ");

  const inner = (
    <>
      <span className="ui-btn-label">{label}</span>
      {icon ? (
        <span className={`ui-iconwell ui-iconwell--${iconWellVariant}${!iconGlow ? " ui-iconwell--no-glow" : ""}`}>
          {icon}
        </span>
      ) : null}
    </>
  );

  const wrapClass = `ui-btn-wrap${fullWidth ? " ui-btn-wrap--full" : ""}`;

  if (href && !disabled) {
    return (
      <div className={wrapClass}>
        <a
          className={classes}
          href={href}
          aria-label={label}
          {...(download !== undefined ? { download: download === true ? "" : download } : {})}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {inner}
        </a>
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      <button
        type="button"
        className={classes}
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
      >
        {inner}
      </button>
    </div>
  );
}
