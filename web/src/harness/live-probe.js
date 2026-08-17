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

  /** Select mode: clicks pick elements instead of reaching the app. */
  var selecting = true;

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

  document.addEventListener(
    "click",
    function (e) {
      if (!selecting) return;
      e.preventDefault();
      e.stopPropagation();
      var hit = frameForClick(e.target);
      if (hit) {
        highlight(hit.el);
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

  /** Ctrl+wheel is canvas zoom, same as the component harness — without
   * this the iframe swallows the gesture and the editor never sees it.
   * Forwarded in both select and interact modes; the page itself never
   * needs pinch-zoom inside the canvas. */
  window.addEventListener(
    "wheel",
    function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      post({ type: "live-zoom", dir: e.deltaY < 0 ? 1 : -1 });
    },
    { passive: false },
  );

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
      if (selecting === false && box) box.style.display = "none";
    } else if (msg.uaiCmd === "ping") {
      var el = document.querySelector("main, #__next, body");
      var frame = el ? ownerFrame(fiberOf(el)) : null;
      post({ type: "live-pong", url: location.href, react: !!(el && fiberOf(el)), frame: frame });
    }
  });

  post({ type: "live-ready", url: location.href, title: document.title });
})();
