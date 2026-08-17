/**
 * Live probe — u-and-i's eyes inside the target app.
 *
 * Injected by server/live-proxy.ts into every HTML page the mirrored app
 * serves. It runs inside the real running app, so it is plain JS with no
 * build step and no imports: it must not assume anything about the page.
 *
 * Jobs: announce itself to the editor, and turn a click into a compiled
 * source position (`live-click`) that the daemon runs back through source
 * maps to a real file + JSX node. Select mode is the default; the editor's
 * Interact toggle (`uaiCmd: "set-interact"`) lets clicks through to the app.
 */
(function () {
  "use strict";
  if (window.__uaiProbe) return;
  window.__uaiProbe = true;

  var post = function (msg) {
    try {
      window.parent.postMessage(Object.assign({ uai: true }, msg), "*");
    } catch (err) {
      /* not framed — the probe is harmless on its own */
    }
  };

  /** The React fiber behind a DOM node, if this page is a React app. */
  function fiberOf(el) {
    for (var key in el) {
      if (key.indexOf("__reactFiber$") === 0) return el[key];
    }
    return null;
  }

  /** First stack frame belonging to the app rather than to React itself.
   * React 19 dropped _debugSource, but every element still carries the
   * owner stack that created it — a compiled position a source map can
   * translate back to the real file. */
  function ownerFrame(fiber) {
    var stack = fiber && fiber._debugStack;
    if (!stack || !stack.stack) return null;
    var lines = String(stack.stack).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf("jsxDEV") >= 0 || line.indexOf("fakeJSXCallSite") >= 0) continue;
      if (line.indexOf("react_stack_bottom_frame") >= 0) break;
      var m = line.match(/\((.+):(\d+):(\d+)\)\s*$/);
      if (m) return { url: m[1], line: Number(m[2]), column: Number(m[3]), raw: line.trim() };
    }
    return null;
  }

  /** Select (edit) mode freezes the page: a transparent overlay sits above
   * everything, so hover states, cursor changes and clicks never reach the
   * app, and we hit-test through it ourselves. Hovering outlines the
   * element a click would select, with its tag as a chip. Interact (view)
   * mode removes all of it and hands the page back. */
  var selecting = true;
  var overlay = null;
  var hoverBox = null;
  var hoverChip = null;
  var freezeStyle = null;

  /** One reusable outline box so the user sees what they picked. It tracks
   * nothing — any scroll or layout shift just leaves it until the next
   * click, which is fine for a selection flash. */
  var box = null;
  function highlight(el) {
    if (!box) {
      box = document.createElement("div");
      box.style.cssText =
        "position:fixed;z-index:2147483647;pointer-events:none;" +
        "border:1.5px solid #4a9eff;background:rgba(74,158,255,0.08);border-radius:2px";
      document.documentElement.appendChild(box);
    }
    var r = el.getBoundingClientRect();
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    box.style.display = "block";
  }

  /** The clicked element's owner frame: walk up the DOM for a node React
   * knows, then up the fiber tree for a frame that names app code. */
  function frameForClick(target) {
    var el = target;
    while (el && el.nodeType === 1) {
      var fiber = fiberOf(el);
      var f = fiber;
      while (f) {
        var frame = ownerFrame(f);
        if (frame) return { el: el, frame: frame };
        f = f.return;
      }
      el = el.parentElement;
    }
    return null;
  }

  /** The page element under a viewport point, looking through our own
   * chrome (the overlay is always the topmost hit in select mode). */
  function hitAt(x, y) {
    var els = document.elementsFromPoint(x, y);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el === overlay || el === hoverBox || el === hoverChip || el === box) continue;
      var tag = el.tagName ? el.tagName.toUpperCase() : "";
      if (tag === "NEXTJS-PORTAL" || tag === "HTML") continue;
      return el;
    }
    return null;
  }

  /** Every distinct selectable element in the stack under a point — the
   * topmost hit first, then covered siblings and ancestors beneath it.
   * Each entry has already been through the fiber walk, deduped by the
   * element it lands on (a decorative wrapper usually resolves to the
   * same element as what it covers). */
  function candidatesAt(x, y) {
    var els = document.elementsFromPoint(x, y);
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el === overlay || el === hoverBox || el === hoverChip || el === box) continue;
      var tag = el.tagName ? el.tagName.toUpperCase() : "";
      if (tag === "NEXTJS-PORTAL" || tag === "HTML") continue;
      var hit = frameForClick(el);
      if (!hit) continue;
      var dup = false;
      for (var j = 0; j < out.length; j++) {
        if (out[j].el === hit.el) { dup = true; break; }
      }
      if (!dup) out.push(hit);
    }
    return out;
  }

  /** The chip sits OUTSIDE the box it labels — above when there is room,
   * below otherwise — so it never covers the selection (a chip inside a
   * small element can hide it entirely). Inside, pinned to the top edge,
   * only when the box fills the viewport and there is no outside. */
  function placeChip(r, text) {
    hoverChip.textContent = text;
    hoverChip.style.display = "block";
    var h = 20;
    var top;
    if (r.top >= h + 2) top = r.top - h;
    else if (r.bottom + h + 2 <= window.innerHeight) top = r.bottom + 2;
    else top = Math.max(2, r.top + 2);
    hoverChip.style.top = top + "px";
    var left = Math.max(0, Math.min(r.left, window.innerWidth - hoverChip.offsetWidth - 2));
    hoverChip.style.left = left + "px";
  }

  /** Hover affordance: outline + tag chip on whatever a click would pick.
   * rAF-throttled; re-aimed on scroll so it never points at stale pixels. */
  var hoverXY = null;
  var hoverQueued = false;
  function hideHover() {
    if (hoverBox) hoverBox.style.display = "none";
    if (hoverChip) hoverChip.style.display = "none";
  }
  function queueHover(x, y) {
    hoverXY = { x: x, y: y };
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(function () {
      hoverQueued = false;
      if (!hoverXY || !selecting) return;
      // While the cursor sits on a drill spot, the selection flash and its
      // depth chip own the pixels — hover would snap back to the top hit.
      if (lastPick && Math.abs(hoverXY.x - lastPick.x) < 6 && Math.abs(hoverXY.y - lastPick.y) < 6) return;
      var el = hitAt(hoverXY.x, hoverXY.y);
      var hit = el ? frameForClick(el) : null;
      if (!hit) return hideHover();
      var r = hit.el.getBoundingClientRect();
      hoverBox.style.left = r.left + "px";
      hoverBox.style.top = r.top + "px";
      hoverBox.style.width = r.width + "px";
      hoverBox.style.height = r.height + "px";
      hoverBox.style.display = "block";
      placeChip(r, (hit.el.tagName || "").toLowerCase());
    });
  }

  function ensureUI() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.setAttribute("data-uai-overlay", "");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483645;background:transparent;cursor:default";
    hoverBox = document.createElement("div");
    hoverBox.setAttribute("data-uai-hover", "");
    hoverBox.style.cssText =
      "position:fixed;z-index:2147483646;pointer-events:none;display:none;" +
      "border:1px solid rgba(74,158,255,0.85);background:rgba(74,158,255,0.05);border-radius:2px";
    hoverChip = document.createElement("div");
    hoverChip.style.cssText =
      "position:fixed;z-index:2147483646;pointer-events:none;display:none;" +
      "background:#4a9eff;color:#fff;font:11px/1.7 system-ui,sans-serif;" +
      "padding:0 6px;border-radius:3px;white-space:nowrap";
    // Freeze the page while editing: paused animations, no transitions.
    freezeStyle = document.createElement("style");
    freezeStyle.setAttribute("data-uai-freeze", "");
    freezeStyle.textContent =
      "*,*::before,*::after{animation-play-state:paused !important;transition:none !important}";
    overlay.addEventListener("mousemove", function (e) {
      queueHover(e.clientX, e.clientY);
    });
    overlay.addEventListener("mouseleave", hideHover);
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(hoverBox);
    document.documentElement.appendChild(hoverChip);
  }

  function applyMode() {
    ensureUI();
    overlay.style.display = selecting ? "block" : "none";
    if (selecting) {
      if (!freezeStyle.parentNode) document.documentElement.appendChild(freezeStyle);
    } else {
      if (freezeStyle.parentNode) freezeStyle.parentNode.removeChild(freezeStyle);
      hideHover();
      if (box) box.style.display = "none";
      lastPick = null;
    }
  }

  // The overlay owns the pointer in select mode, so clicks land on it —
  // hit-test through it for the real target. Capture phase as a backstop
  // for anything stacked above the overlay.
  //
  // Repeated clicks in the same spot drill through the stack: a fully
  // covered element (image behind a gradient, card behind a stretched
  // link) is unreachable from the top hit alone, so each click selects
  // the next distinct element beneath the last, wrapping at the bottom.
  var lastPick = null; // { x, y, i } of the previous select click
  document.addEventListener(
    "click",
    function (e) {
      if (!selecting) return;
      e.preventDefault();
      e.stopPropagation();
      var cands = candidatesAt(e.clientX, e.clientY);
      var i = 0;
      if (
        cands.length &&
        lastPick &&
        Math.abs(lastPick.x - e.clientX) < 6 &&
        Math.abs(lastPick.y - e.clientY) < 6
      ) {
        i = (lastPick.i + 1) % cands.length;
      }
      lastPick = { x: e.clientX, y: e.clientY, i: i };
      var hit = cands[i] || null;
      if (hit) {
        highlight(hit.el);
        hoverBox.style.display = "none";
        // The chip doubles as a depth gauge while drilling.
        placeChip(
          hit.el.getBoundingClientRect(),
          (hit.el.tagName || "").toLowerCase() + (cands.length > 1 ? " · " + (i + 1) + "/" + cands.length : ""),
        );
        post({
          type: "live-click",
          url: hit.frame.url,
          line: hit.frame.line,
          column: hit.frame.column,
          tag: (hit.el.tagName || "").toLowerCase(),
          page: location.href,
        });
      } else {
        post({ type: "live-click", url: null, page: location.href });
      }
    },
    true,
  );

  // Scrolling still works in select mode (the wheel's default action
  // scrolls the document past the fixed overlay), but the hover outline
  // must chase the content as it moves.
  window.addEventListener(
    "scroll",
    function () {
      if (selecting && hoverXY) queueHover(hoverXY.x, hoverXY.y);
    },
    { passive: true, capture: true },
  );

  /** Middle-drag pans the canvas. In select (edit) mode the page is frozen
   * anyway, so a plain middle-drag is ours; in interact (view) mode only
   * Ctrl+middle is taken, leaving the page its native middle-click
   * behaviours (autoscroll, open-in-tab). Deltas are content px — the
   * editor scales them by its own zoom. */
  // ⚠️ Deltas come from screenX/Y, and the editor applies them 1:1 — moving
  // the window with the cursor is a SCREEN-pixel relationship. clientX/Y
  // won't do: they live in the iframe's scaled coordinate space, which the
  // pan itself shifts under the cursor (feedback → half-speed jitter), and
  // movementX/Y is raw device px, blind to the scale. Screen coords are
  // immune to both.
  var panDrag = null; // last {x, y} in screen px while middle-dragging
  window.addEventListener(
    "mousedown",
    function (e) {
      if (e.button !== 1) return;
      if (!selecting && !e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      panDrag = { x: e.screenX, y: e.screenY };
    },
    true,
  );
  window.addEventListener(
    "mousemove",
    function (e) {
      if (!panDrag) return;
      post({ type: "live-pan", dx: e.screenX - panDrag.x, dy: e.screenY - panDrag.y });
      panDrag = { x: e.screenX, y: e.screenY };
    },
    true,
  );
  window.addEventListener(
    "mouseup",
    function (e) {
      if (e.button === 1) panDrag = null;
    },
    true,
  );
  window.addEventListener("blur", function () {
    panDrag = null;
  });

  /** Ctrl+wheel is canvas zoom, same as the component harness — without
   * this the iframe swallows the gesture and the editor never sees it.
   * Forwarded in both select and interact modes; the page itself never
   * needs pinch-zoom inside the canvas. */
  window.addEventListener(
    "wheel",
    function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // clientX/Y are content coordinates: the CSS scale on the iframe is
      // the parent's affair — inside, the page is unscaled. The editor
      // anchors the zoom on this point.
      post({ type: "live-zoom", dir: e.deltaY < 0 ? 1 : -1, x: e.clientX, y: e.clientY });
    },
    { passive: false },
  );

  /** Tab is the editor's Edit/View toggle and must work while the live
   * frame has focus (any click on the canvas focuses the iframe, and the
   * parent window never sees keys after that). Captured before the page
   * can move focus with it; real form fields keep their Tab. Escape
   * forwards too so the editor can close its own popovers. */
  window.addEventListener(
    "keydown",
    function (e) {
      var t = e.target;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        post({ type: "toggle-interact" });
      } else if (e.key === "Escape") {
        post({ type: "escape" });
      }
    },
    true,
  );

  /** The canvas is a design surface, not a browser: hide the ROOT
   * scrollbar. The app forces `overflow-y: scroll` on html, so the track
   * shows even when nothing scrolls — and it takes no layout space here
   * (overlay style), so hiding it shifts nothing. Wheel scrolling still
   * works; inner scrollable regions keep their own bars. */
  (function () {
    var s = document.createElement("style");
    s.setAttribute("data-uai-no-scrollbar", "");
    s.textContent = "html::-webkit-scrollbar{display:none}html{scrollbar-width:none}";
    document.documentElement.appendChild(s);
  })();

  /** Hide Next's dev-tools badge — and only the badge. It lives as
   * `#devtools-indicator` inside the open `nextjs-portal` shadow root;
   * build-error overlays are siblings in the same root and must stay
   * visible, so this styles the one id rather than the portal. The
   * observer catches the portal mounting late or being remounted. */
  function hideDevBadge() {
    var portals = document.querySelectorAll("nextjs-portal");
    for (var i = 0; i < portals.length; i++) {
      var root = portals[i].shadowRoot;
      if (!root || root.querySelector("style[data-uai-hide-badge]")) continue;
      var style = document.createElement("style");
      style.setAttribute("data-uai-hide-badge", "");
      style.textContent = "#devtools-indicator{display:none !important}";
      root.appendChild(style);
    }
  }
  hideDevBadge();
  new MutationObserver(hideDevBadge).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("message", function (e) {
    var msg = e.data;
    if (!msg || !msg.uaiCmd) return;
    if (msg.uaiCmd === "set-interact") {
      selecting = !msg.on;
      applyMode();
    } else if (msg.uaiCmd === "ping") {
      var el = document.querySelector("main, #__next, body");
      var frame = el ? ownerFrame(fiberOf(el)) : null;
      post({ type: "live-pong", url: location.href, react: !!(el && fiberOf(el)), frame: frame });
    }
  });

  applyMode();
  post({ type: "live-ready", url: location.href, title: document.title });
})();
