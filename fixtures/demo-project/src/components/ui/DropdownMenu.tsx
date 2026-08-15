"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <DropdownMenu />
// ---------------------------------------------------------------------------
// Card-surfaced panel with stacked menu items. Trigger is external — this
// just renders the open menu. Items use inset hover (§4.5 pattern).

export interface MenuItemDef {
  id: string;
  label: string;
  icon?: ReactNode;
  /**
   * A horizontal rule between groups of options. Renders instead of a row —
   * `label`, `icon` and `disabled` are ignored.
   *
   * ⚠️ Added 2026-08-06 to replace an overload of `disabled`. Separators used to
   * be drawn by passing `{ label: "", disabled: true }`, which meant the two
   * states shared one flag and `disabled` did not mean what it says. The first
   * caller to use `disabled` for its actual meaning got a 2px sliver with the
   * label spilling outside the menu.
   */
  divider?: boolean;
  /**
   * The option exists but cannot be chosen right now — dimmed, not removed.
   *
   * ⛔ NOT a separator. See `divider`.
   */
  disabled?: boolean;
}

interface DropdownMenuProps {
  items: MenuItemDef[];
  onSelect: (id: string) => void;
}

export function DropdownMenu({ items, onSelect }: DropdownMenuProps) {
  return (
    <div className="ui-dropdown">
      {items.map((item) =>
        item.divider ? (
          // A real separator element rather than an unlabelled disabled button —
          // which is also what stops a screen reader announcing the rule as an
          // empty menu option, and stops it taking a tab stop.
          <div key={item.id} className="ui-dropdown-divider" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            className="ui-dropdown-item"
            disabled={item.disabled}
            onClick={() => onSelect(item.id)}
          >
            {item.icon ? <span className="ui-dropdown-item-icon">{item.icon}</span> : null}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
