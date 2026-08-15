"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// <Modal />
// ---------------------------------------------------------------------------
// A centred card over a dimmed page, built on the native <dialog> element.
//
// ⚠️ **Built on `<dialog>` deliberately, and it must be opened with
// `showModal()`.** The platform gives four things a hand-rolled overlay has to
// reimplement and usually gets wrong: a focus trap, Esc-to-close, rendering in
// the TOP LAYER (so no z-index in the app can ever paint over it), and inerting
// the page behind it for assistive tech.
//
// ⛔ **Never render it with the `open` attribute instead.** `<dialog open>` is a
// NON-modal dialog: no backdrop, no focus trap, no top layer, and the page behind
// stays interactive. It looks almost right and is none of the things above — which
// is exactly the kind of failure that reaches a user rather than a test.
//
// The dialog is uncontrolled internally and driven by the `open` prop through an
// effect, so callers keep their own state and never touch the DOM.

interface ModalProps {
  open: boolean;
  /** Fired by Esc, the backdrop, and the close button alike. */
  onClose: () => void;
  /** Accessible name — also drawn as the heading. */
  title: string;
  /** Optional quieter line under the title (e.g. which booking is being edited). */
  subtitle?: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, subtitle, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `showModal()` on an already-open dialog throws, and `close()` on a closed
    // one fires a spurious `close` event — so both are guarded on actual state
    // rather than on the prop alone.
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  /**
   * Lock the page behind the dialog.
   *
   * ⚠️ `<dialog>` does NOT do this. `showModal()` inerts the page for clicks and
   * for assistive tech, but the document still scrolls — so the content behind the
   * modal slides around under it, which reads as the dialog itself drifting.
   *
   * ⚠️ Hiding the overflow removes the scrollbar, and on a desktop that reflows the
   * whole page a few pixels wider the moment the dialog opens. The gutter is
   * measured and replaced as padding so nothing behind the backdrop moves.
   * ⛔ Do not "simplify" this to `overflow: hidden` alone — the jump it causes is
   * most visible on exactly the wide layouts this app is built for.
   */
  useEffect(() => {
    if (!open) return;
    /**
     * ⚠️ Locked on `<html>`, NOT `<body>`. The viewport takes its overflow from the
     * ROOT element and only falls back to `<body>` when the root computes to
     * `visible` — and this app sets `html { overflow-y: scroll }` (to hold the
     * scrollbar gutter and stop pages jumping as their height changes). With that
     * set, `body { overflow: hidden }` propagates nowhere and the page behind the
     * dialog scrolls exactly as before. Verified: `document.scrollingElement` is
     * `<html>`, and the body-only version left `window.scrollY` free to move.
     */
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    const prevPadding = root.style.paddingRight;
    // Measured BEFORE hiding, or the gutter is already gone by the time we ask.
    const gutter = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    // Replace the scrollbar's width as padding so nothing behind the backdrop
    // reflows the moment the dialog opens.
    if (gutter > 0) root.style.paddingRight = `${gutter}px`;
    return () => {
      // Restore the PREVIOUS values rather than clearing: two stacked dialogs, or
      // any other code that set them, must not have their state wiped by whichever
      // one happens to close first.
      root.style.overflow = prevOverflow;
      root.style.paddingRight = prevPadding;
    };
  }, [open]);

  // Esc closes the dialog natively; the `close` event is the ONLY place that
  // reaches the caller, so keyboard and button dismissal cannot diverge.
  const handleClose = useCallback(() => onClose(), [onClose]);

  /**
   * Backdrop click.
   *
   * ⚠️ `<dialog>` has no backdrop element to listen on — the backdrop is painted
   * by the dialog's own `::backdrop` pseudo, so a click out there lands on the
   * DIALOG. Comparing `e.target` to the dialog itself is what distinguishes
   * "clicked the dim area" from "clicked something inside the card", which is why
   * the content lives in a child element rather than directly on the dialog.
   */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === ref.current) onClose();
    },
    [onClose],
  );

  return (
    <dialog ref={ref} className="ui-modal" onClose={handleClose} onClick={handleClick}>
      <div className="ui-modal-card">
        <header className="ui-modal-head">
          <div className="ui-modal-titles">
            <h2 className="ui-modal-title">{title}</h2>
            {subtitle ? <p className="ui-modal-subtitle">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="ui-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            {/* A glyph, not an icon font — one character that cannot fail to load. */}
            <span aria-hidden>×</span>
          </button>
        </header>
        <div className="ui-modal-body">{children}</div>
      </div>
    </dialog>
  );
}
