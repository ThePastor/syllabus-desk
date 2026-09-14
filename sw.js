/* ============================================================================
   Syllabus Desk service worker  ·  build 3.6

   Two jobs, and a rule about each.

   1. Make the page open with no signal. The shell is precached on install.
   2. Never serve a stale build to somebody who is online. Navigations are
      network-first with a short timeout, so the page you get is the page that
      is published; the cache is the fallback, not the default.

   The rule that matters most: a request carrying ?_v= is the page checking
   whether a newer build exists, and it is passed straight to the network,
   untouched. If the worker ever answered that from cache the app would decide
   it was up to date forever.
   ========================================================================== */
var VER   = "3.6";
var SHELL = "sd-shell-" + VER;
var HOME  = "./index.html";
var FILES = ["./", HOME, "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
             "./icon-maskable-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      return c.addAll(FILES.map(function (u) { return new Request(u, { cache: "reload" }); }));
    }).then(function () { return self.skipWaiting(); })
     .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf("sd-shell-") === 0 && k !== SHELL) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* worth keeping: only a same-origin, ok, non-opaque response may enter the
   cache. Anything else - a redirect, a 404, a captive-portal login page - would
   otherwise be served back later as if it were the app. */
function keepable(res) {
  return res && res.ok && res.type === "basic";
}

function netFirst(req) {
  return new Promise(function (resolve) {
    var settled = false;
    var fallback = function () {
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return resolve(hit);
        caches.match(HOME).then(function (home) {
          resolve(home || new Response("Offline, and no saved copy on this device yet.",
            { status: 503, headers: { "Content-Type": "text/plain" } }));
        });
      });
    };
    var timer = setTimeout(function () {
      if (settled) return; settled = true; fallback();
    }, 3000);
    fetch(req).then(function (res) {
      if (settled) { if (keepable(res)) { var late = res.clone();
        caches.open(SHELL).then(function (c) { c.put(HOME, late); }).catch(function () {}); }
        return; }
      settled = true; clearTimeout(timer);
      if (keepable(res)) { var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(HOME, copy); }).catch(function () {}); }
      resolve(res);
    }).catch(function () {
      if (settled) return; settled = true; clearTimeout(timer); fallback();
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   /* fonts, cdnjs, supabase: not ours to cache */
  if (url.searchParams.has("_v")) return;            /* the update check must reach the network */

  var wantsHTML = req.mode === "navigate" ||
                  (req.headers.get("accept") || "").indexOf("text/html") > -1;
  if (wantsHTML) { e.respondWith(netFirst(req)); return; }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (keepable(res)) { var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); }).catch(function () {}); }
        return res;
      });
    })
  );
});

/* the page asks for this after the student takes an update */
self.addEventListener("message", function (e) {
  if (e.data === "sd-refresh") {
    caches.delete(SHELL).then(function () {
      return caches.open(SHELL).then(function (c) {
        return c.addAll(FILES.map(function (u) { return new Request(u, { cache: "reload" }); }));
      });
    }).catch(function () {});
  }
});
