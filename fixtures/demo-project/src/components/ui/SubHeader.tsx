"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <SubHeader />
// ---------------------------------------------------------------------------
// Page-title card that tucks under the sticky site Header. Top edge slides
// behind the header; bottom edge rests flush in the content area. Top
// corners are square (hidden under the header), bottom corners rounded —
// reads as "attached below".
//
// Place as the first element of a page. The page container should have
// `padding-top: 0` so the negative margin can pull the card up under the
// header.

interface SubHeaderProps {
  children: ReactNode;
  /**
   * Element used for the title. Defaults to `h1`, since this component's home
   * is the top of a page.
   *
   * ⚠️ Anywhere that is NOT the page title must pass something else. The
   * footer's copyright notice borrows this card's SHAPE, not its rank: a second
   * `h1` on a page that already has one, holding a legal notice, puts nonsense
   * in the heading outline and drops a screen-reader user navigating by heading
   * straight onto it.
   */
  as?: "h1" | "h2" | "p";
}

export function SubHeader({ children, as: Title = "h1" }: SubHeaderProps) {
  return (
    <div className="ui-subheader-slot">
      <div className="ui-card ui-subheader-card">
        <Title className="ui-subheader-title">{children}</Title>
      </div>
    </div>
  );
}
