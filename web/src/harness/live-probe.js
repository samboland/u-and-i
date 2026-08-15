/**
 * Live probe — u-and-i's eyes inside the target app.
 *
 * Injected by server/live-proxy.ts into every HTML page the mirrored app
 * serves. It runs inside the real running app, so it is plain JS with no
 * build step and no imports: it must not assume anything about the page.
 *
 * Step 1 scope: announce itself to the editor and answer "is React here?".
 * Step 3 turns the fiber walk below into a source location (file + line),
 * which the AST engine turns back into a node id.
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

  window.addEventListener("message", function (e) {
    var msg = e.data;
    if (!msg || msg.uaiCmd !== "ping") return;
    var el = document.querySelector("main, #__next, body");
    var frame = el ? ownerFrame(fiberOf(el)) : null;
    post({ type: "live-pong", url: location.href, react: !!(el && fiberOf(el)), frame: frame });
  });

  post({ type: "live-ready", url: location.href, title: document.title });
})();
