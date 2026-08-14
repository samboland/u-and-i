"use client";

import { useId } from "react";

// ---------------------------------------------------------------------------
// <TextField />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.12 (pending). Concave trough (same shading family as
// §3.4 SearchBar) with a transparent input overlay. Smaller than the
// search bar and carries a left-aligned field-name label that rests
// directly above the trough. No blue glow — just a subtle brightness
// lift on focus.
//
// Multiline mode renders a `<textarea>` inside the same trough. Same
// look-and-feel, just taller. Use `rows` to size; `resize="vertical"`
// lets the user grow it but never shrinks horizontally.

interface BaseProps {
  label: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  maxLength?: number;
}

interface SingleLineProps extends BaseProps {
  multiline?: false;
  type?: "text" | "email" | "password" | "number" | "tel" | "url";
  rows?: never;
}

interface MultilineProps extends BaseProps {
  multiline: true;
  rows?: number;
  /** When false, the textarea grip handle is suppressed. Defaults to true. */
  resizable?: boolean;
  type?: never;
}

type TextFieldProps = SingleLineProps | MultilineProps;

export function TextField(props: TextFieldProps) {
  const { label, placeholder, value, onChange, name, id, disabled, maxLength } = props;
  const generatedId = useId();
  const inputId = id ?? `ui-textfield-${generatedId}`;

  const sharedClass = "ui-textfield-input";

  return (
    <div className="ui-textfield">
      <label className="ui-textfield-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="ui-textfield-input-wrap">
        {props.multiline ? (
          <textarea
            id={inputId}
            name={name}
            className={sharedClass}
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            maxLength={maxLength}
            rows={props.rows ?? 4}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            style={{
              resize: props.resizable === false ? "none" : "vertical",
              lineHeight: 1.45,
              padding: "0.5rem 0",
            }}
          />
        ) : (
          <input
            id={inputId}
            type={props.type ?? "text"}
            name={name}
            className={sharedClass}
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            maxLength={maxLength}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          />
        )}
      </div>
    </div>
  );
}
