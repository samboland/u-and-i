/**
 * Secretless Icon Library
 *
 * Thin wrapper around lucide-react. The wrapper fixes the overlap
 * artifact issue: CSS drop-shadow filters are applied to a parent
 * <span>, not directly to the SVG, so overlapping strokes inside
 * the SVG composite cleanly before the shadow is generated.
 *
 * Usage:
 *   import { IconHome, IconSearch } from "@/components/ui/icons";
 *   <IconHome size={18} />
 */

import {
  Home,
  Search,
  User,
  LogOut,
  Sun,
  Moon,
  ChevronDown,
  Check,
  X,
  Plus,
  Minus,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  ExternalLink,
  Menu,
  NotebookPen,
} from "lucide-react";
import type { LucideProps } from "lucide-react";

type IconProps = Omit<LucideProps, "ref"> & { size?: number };

/**
 * Wrapper that splits the icon into two layers:
 *   .ui-icon-wrap — owns the drop-shadow filter (stacking context).
 *   .ui-icon-dim  — owns color + opacity, transitions cleanly because
 *                   no filter is applied at this level.
 * Splitting decouples the wrap's filter stacking context from opacity
 * animations so press / hover state changes fade smoothly instead of
 * snapping.
 */
function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <span className="ui-icon-wrap">
      <span className="ui-icon-dim">{children}</span>
    </span>
  );
}

export function IconHome(p: IconProps) { return <Wrap><Home {...p} /></Wrap>; }
export function IconSearch(p: IconProps) { return <Wrap><Search {...p} /></Wrap>; }
export function IconPerson(p: IconProps) { return <Wrap><User {...p} /></Wrap>; }
export function IconSignOut(p: IconProps) { return <Wrap><LogOut {...p} /></Wrap>; }
export function IconSun(p: IconProps) { return <Wrap><Sun {...p} /></Wrap>; }
export function IconMoon(p: IconProps) { return <Wrap><Moon {...p} /></Wrap>; }
export function IconChevronDown(p: IconProps) { return <Wrap><ChevronDown {...p} /></Wrap>; }
export function IconCheck(p: IconProps) { return <Wrap><Check {...p} /></Wrap>; }
export function IconX(p: IconProps) { return <Wrap><X {...p} /></Wrap>; }
export function IconPlus(p: IconProps) { return <Wrap><Plus {...p} /></Wrap>; }
export function IconMinus(p: IconProps) { return <Wrap><Minus {...p} /></Wrap>; }
export function IconArrowUp(p: IconProps) { return <Wrap><ArrowUp {...p} /></Wrap>; }
export function IconArrowDown(p: IconProps) { return <Wrap><ArrowDown {...p} /></Wrap>; }
export function IconArrowRight(p: IconProps) { return <Wrap><ArrowRight {...p} /></Wrap>; }
export function IconExternalLink(p: IconProps) { return <Wrap><ExternalLink {...p} /></Wrap>; }
export function IconMenu(p: IconProps) { return <Wrap><Menu {...p} /></Wrap>; }
export function IconNotebookPen(p: IconProps) { return <Wrap><NotebookPen {...p} /></Wrap>; }
