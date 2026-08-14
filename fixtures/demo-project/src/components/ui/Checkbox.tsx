"use client";

import { type ReactNode, useId, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// <Checkbox />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.13 (pending). Recess icon-well square with a raised
// check icon that appears when checked. Label sits to the right. Hover
// and press states are scoped to the well only. On uncheck the check
// briefly bounces back up before fading out.

interface CheckboxProps {
  /**
   * ⚠️ `ReactNode`, not `string` (widened 2026-08-11). Carrier vetting for the SMS
   * program requires the consent label itself to carry links to the Terms and
   * Privacy Policy — the links must sit INSIDE the sentence the user agrees to,
   * not beside it, or the screenshot does not show consent to those documents.
   * Widening is back-compatible: every existing caller passes a string, which is
   * already a ReactNode. Do not hand-roll a second checkbox to get links.
   */
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  id,
}: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? `ui-checkbox-${generatedId}`;
  const [bouncingOut, setBouncingOut] = useState(false);
  const [prevChecked, setPrevChecked] = useState(checked);
  const wellRef = useRef<HTMLLabelElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(null);

  if (prevChecked && !checked && !bouncingOut) {
    setBouncingOut(true);
  }
  if (prevChecked !== checked) {
    setPrevChecked(checked);
  }

  return (
    <div
      className="ui-checkbox"
      data-checked={checked || bouncingOut || undefined}
      data-bounce-out={bouncingOut || undefined}
      data-disabled={disabled || undefined}
    >
      <label
        ref={wellRef}
        className="ui-checkbox-well"
        htmlFor={inputId}
        aria-hidden="true"
        onPointerDown={() => {
          const el = wellRef.current;
          if (!el) return;
          el.classList.add("ui-checkbox-well--press");
          if (pressTimer.current) clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => el.classList.remove("ui-checkbox-well--press"), 150);
        }}
      >
        <svg
          className="ui-checkbox-check"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          onAnimationEnd={() => setBouncingOut(false)}
        >
          <path d="M20.293 5.293a1.75 1.75 0 0 1 0 2.474l-10 10a1.75 1.75 0 0 1-2.474 0l-4.5-4.5a1.75 1.75 0 1 1 2.474-2.474L9.06 14.06l8.76-8.767a1.75 1.75 0 0 1 2.474 0Z" />
        </svg>
      </label>
      {/* ⚠️ A REAL `<label htmlFor>`, not a `<span>` (fixed 2026-08-06). The
          element above is the visual well: it carries `aria-hidden` and holds only
          the tick SVG, so while it made the well clickable it gave the input no
          accessible name — a screen reader announced "checkbox, unchecked" with no
          indication of what it toggles, and clicking the words did nothing. An
          input may have several labels; the well stays aria-hidden so this is the
          only one announced. */}
      <label className="ui-checkbox-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="checkbox"
        className="ui-checkbox-input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}
