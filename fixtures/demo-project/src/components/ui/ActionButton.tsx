"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <ActionButton />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.20 (pending). Colored action button built on the
// PrimaryButton convex stack. Wraps the same .ui-btn / .ui-btn-wrap
// structure with an accent background-color override. Uses the bulge
// icon well variant for the optional trailing icon.

interface ActionButtonProps {
  label: string;
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
  color?: string;
  textColor?: string;
  disabled?: boolean;
  external?: boolean;
  size?: "sm" | "md" | "lg";
}

export function ActionButton({
  label,
  icon,
  href,
  onClick,
  // Brand sea blue (mode-invariant, per the colored-surfaces rule) with cream
  // text. Callers can still override via `color` / `textColor`.
  color = "#1E8CBA",
  textColor = "#FDFBF7",
  disabled,
  external,
  size = "md",
}: ActionButtonProps) {
  const btnClass = `ui-btn${icon ? "" : " ui-btn--no-icon"} ui-action-btn`;
  const sizeStyle =
    size === "lg"
      ? {
          padding: "0.875rem 0.875rem 0.875rem 1.5rem",
          fontSize: "1.125rem",
          gap: "0.875rem",
        }
      : size === "sm"
        ? {
            // Compact variant for dense surfaces (operator dashboard
            // user cards). Shorter vertical metric than the .ui-btn
            // default with a tighter font + gap.
            padding: "0.25rem 0.625rem",
            fontSize: "0.75rem",
            gap: "0.375rem",
            minHeight: 26,
          }
        : undefined;

  const inner = (
    <>
      <span className="ui-btn-label" style={{ color: textColor }}>{label}</span>
      {icon && (
        <span className="ui-iconwell ui-iconwell--bulge">
          {icon}
        </span>
      )}
    </>
  );

  if (href && !disabled) {
    return (
      <div className="ui-btn-wrap">
        <a
          className={btnClass}
          href={href}
          style={{ backgroundColor: color, color: textColor, ...sizeStyle }}
          {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow sponsored" } : {})}
        >
          {inner}
        </a>
      </div>
    );
  }

  return (
    <div className="ui-btn-wrap">
      <button
        type="button"
        className={btnClass}
        style={{ backgroundColor: color, color: textColor, ...sizeStyle }}
        onClick={onClick}
        disabled={disabled}
      >
        {inner}
      </button>
    </div>
  );
}
