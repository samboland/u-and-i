"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// <SearchBar />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.4. Concave trough (same as toggle track / recess well)
// with a transparent text input inside. The input text sits on the trough
// surface with the standard glyph-float shadow so it reads as raised.
//
// Accepts extra slots so richer callers (header search with combobox
// semantics, dropdown wiring, clear affordance, loading indicator) can
// layer on top of the base visual without re-implementing it.

interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  /**
   * Extra attributes merged onto the underlying `<input>` — role,
   * aria-*, autoFocus, onFocus/Blur/KeyDown, etc. Used by the header
   * search to declare combobox semantics.
   */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  /**
   * Optional content rendered at the trailing (right) edge of the
   * trough — typically a clear button or a loading spinner. Sits
   * inside the trough, aligned vertically.
   */
  rightSlot?: ReactNode;
}

export interface SearchBarHandle {
  focus: () => void;
}

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(
  function SearchBar(
    { placeholder = "Search...", value, onChange, inputProps, rightSlot },
    ref,
  ) {
    const searchRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const flashTimer = useRef<ReturnType<typeof setTimeout>>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    const handleInput = useCallback(() => {
      const el = searchRef.current;
      if (!el) return;
      el.classList.add("ui-search--keystroke");
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        el.classList.remove("ui-search--keystroke");
      }, 60);
    }, []);

    const focusInput = useCallback(() => inputRef.current?.focus(), []);

    return (
      <div className="ui-search" ref={searchRef}>
        <button
          type="button"
          className="ui-search-icon-btn"
          aria-label="Focus search input"
          onClick={focusInput}
          tabIndex={-1}
        >
          <span className="ui-search-icon" aria-hidden="true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M11 2a9 9 0 1 0 5.32 16.32l3.18 3.18a1.25 1.25 0 0 0 1.77-1.77l-3.18-3.18A9 9 0 0 0 11 2ZM4.5 11a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z"
              />
            </svg>
          </span>
        </button>
        <input
          ref={inputRef}
          type="text"
          className="ui-search-input"
          placeholder={placeholder}
          value={value}
          onInput={handleInput}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          {...inputProps}
        />
        {rightSlot && <span className="ui-search-right-slot">{rightSlot}</span>}
      </div>
    );
  },
);
