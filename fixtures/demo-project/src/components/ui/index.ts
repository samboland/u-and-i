import "./ui.css";

// Suppress right-click context menu on all UI library interactive elements.
// Runs once when the barrel is imported (layout mounts the barrel globally).
if (typeof document !== "undefined") {
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (
      t?.closest(
        ".ui-btn, .ui-iconbtn, .ui-vote, .ui-toggle, .ui-tabbar-tab, " +
        ".ui-switch, .ui-checkbox, .ui-dropdown-item, .ui-action-btn, .ui-search-clear"
      )
    ) {
      e.preventDefault();
    }
  });
}

export { ActionButton } from "./ActionButton";
export { Badge } from "./Badge";
export { Checkbox } from "./Checkbox";
export { LinkText } from "./LinkText";
export { LiftText } from "./LiftText";
export { PressWell } from "./PressWell";
export { PrimaryButton } from "./PrimaryButton";
export { ProConCard } from "./ProConCard";
export { IconWell } from "./IconWell";
export { IconButton } from "./IconButton";
export { InfoHint } from "./InfoHint";
export { Card } from "./Card";
export { CardStack } from "./CardStack";
export { ComplianceBadge } from "./ComplianceBadge";
export { FormFactorBar } from "./FormFactorBar";
export { NavCardStack } from "./NavCardStack";
export { SectionCard } from "./SectionCard";
export { SubHeader } from "./SubHeader";
export { SubPanel, SubPanelCell } from "./SubPanel";
export { SidePanel } from "./SidePanel";
export type { SidePanelItem } from "./SidePanel";
export { UseRow } from "./UseRow";
export type { CardStackLevel } from "./CardStack";
export type { NavCardLevel } from "./NavCardStack";
export { Divider } from "./Divider";
export { AppBar } from "./AppBar";
export { Navbar } from "./Navbar";
export { TabBar } from "./TabBar";
export { DropdownMenu } from "./DropdownMenu";
export { DropdownButton } from "./DropdownButton";
export { SearchBar, type SearchBarHandle } from "./SearchBar";
export { Grainient } from "./Grainient";
export type { GrainientProps } from "./Grainient";
export { Secredit, SecreditIcon } from "./Secredit";
export type { SecreditProps, SecreditIconProps } from "./Secredit";
export { StarRating } from "./StarRating";
export { Modal } from "./Modal";
export { StatBar } from "./StatBar";
export { TextField } from "./TextField";
export { Toggle } from "./Toggle";
export { Switch } from "./Switch";
export { VoteButton } from "./VoteButton";

export type { MenuItemDef } from "./DropdownMenu";

// Icon library — all paths pre-unioned, no overlap artifacts
export {
  IconHome, IconSearch, IconPerson, IconSignOut,
  IconSun, IconMoon, IconChevronDown, IconCheck, IconX,
  IconPlus, IconMinus, IconArrowUp, IconArrowDown, IconArrowRight,
  IconExternalLink, IconMenu, IconNotebookPen,
} from "./icons";
