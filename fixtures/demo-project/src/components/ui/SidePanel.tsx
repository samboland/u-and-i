"use client";

import { type CSSProperties, type ReactNode } from "react";
import { Navbar } from "./Navbar";

// ---------------------------------------------------------------------------
// <SidePanel />
// ---------------------------------------------------------------------------
// Fixed left-edge panel that tucks under the header. Own card surface
// (tier b by default). All items in a single Navbar — items with
// pinBottom get margin-top:auto to push to the bottom.

export interface SidePanelItem {
  id: string;
  label: string;
  icon?: ReactNode;
  pinBottom?: boolean;
}

interface SidePanelProps {
  items: SidePanelItem[];
  value: string;
  onChange: (id: string) => void;
  collapsed?: boolean;
  topOffset?: number;
  tier?: "a" | "b";
}

export function SidePanel({
  items,
  value,
  onChange,
  collapsed = false,
  topOffset,
  tier = "b",
}: SidePanelProps) {
  return (
    <aside
      className="ui-sidepanel ui-card"
      data-tier={tier}
      /* ⚠️ Only set `--ui-sidepanel-top` when a caller ASKS for one. It used
         to default to 52px inline, and an inline custom property beats every
         stylesheet rule — so CSS could not own the header/rail junction even
         though the header's brand plate defines it. Left unset, ui.css falls
         back to `--ui-header-brand-height`, which the plate also uses, and the
         two cannot drift. Pass a number only for a SidePanel that is not under
         the app header (e.g. a /dev/ui demo). */
      style={
        topOffset === undefined
          ? undefined
          : ({ "--ui-sidepanel-top": `${topOffset}px` } as CSSProperties)
      }
    >
      <Navbar
        items={items}
        value={value}
        onChange={onChange}
        bare
        collapsed={collapsed}
      />
    </aside>
  );
}
