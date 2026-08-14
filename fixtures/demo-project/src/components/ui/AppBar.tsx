"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <AppBar />
// ---------------------------------------------------------------------------
// Horizontal bar — card-surfaced convex strip. Composition container for
// icon buttons, text, search bars, etc. Not interactive itself.

interface AppBarProps {
  children: ReactNode;
}

export function AppBar({ children }: AppBarProps) {
  return <div className="ui-appbar ui-card">{children}</div>;
}
