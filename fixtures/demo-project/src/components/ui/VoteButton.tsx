"use client";

// ---------------------------------------------------------------------------
// <VoteButton />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.16 (pending). Upvote/downvote toggle using a convex
// IconButton (§3.3). Active state tints the button. Uses proper arrow
// icons (not simplified chevrons).

interface VoteButtonProps {
  direction: "up" | "down";
  active?: boolean;
  count?: number;
  onClick?: () => void;
  disabled?: boolean;
}

function ArrowUpIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.293 3.293a1 1 0 0 1 1.414 0l7 7a1 1 0 0 1-1.414 1.414L13 6.414V20a1 1 0 1 1-2 0V6.414l-5.293 5.293a1 1 0 0 1-1.414-1.414l7-7Z" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.707 20.707a1 1 0 0 1-1.414 0l-7-7a1 1 0 1 1 1.414-1.414L11 17.586V4a1 1 0 1 1 2 0v13.586l5.293-5.293a1 1 0 0 1 1.414 1.414l-7 7Z" />
    </svg>
  );
}

export function VoteButton({
  direction,
  active,
  count,
  onClick,
  disabled,
}: VoteButtonProps) {
  return (
    <span className="ui-btn-wrap">
      <button
        type="button"
        className="ui-vote"
        data-direction={direction}
        data-active={active || undefined}
        disabled={disabled}
        onClick={onClick}
        aria-label={`${direction === "up" ? "Upvote" : "Downvote"}${active ? " (active)" : ""}`}
        aria-pressed={active}
      >
        {direction === "up" ? <ArrowUpIcon /> : <ArrowDownIcon />}
        {count !== undefined && <span className="ui-vote-count">{count}</span>}
      </button>
    </span>
  );
}
