"use strict";

// Esta función se inyecta en MAIN world desde el background.
// Al correr DESPUÉS de que Kahoot inició, chrome.runtime.id ya no causa problemas.
// Usa Proxy para que .toString() retorne "[native code]" — invisible a Kahoot.
function kahootNetworkHooks() {
  if (window.__ko_hooked__) return;
  window.__ko_hooked__ = true;

  const KRE = /kahoot\.(it|com)/;
  const isK = function(u) {
    try { return KRE.test(new URL(u, location.href).hostname); } catch(e) { return false; }
  };

  function tryJson(s) {
    if (typeof s !== "string" || s.length < 5) return null;
    const t = s.trim();
    if (t[0] !== "{" && t[0] !== "[") return null;
    try { return JSON.parse(t); } catch(e) { return null; }
  }

  function emit(d, src) {
    try {
      var detail = JSON.stringify(d);
      window.dispatchEvent(new CustomEvent("__ko__", { detail: detail }));
      // When running inside an iframe (live game is often framed), bubble the event
      // to the top-level window so the extension's overlay (only in the top frame)
      // receives it. Same-origin check is implicit — cross-origin throws and is caught.
      if (window !== window.top) {
        try { window.top.dispatchEvent(new CustomEvent("__ko__", { detail: detail })); } catch(_) {}
      }
    } catch(e) {}
  }

  // fetch
  try {
    const _f = window.fetch;
    window.fetch = new Proxy(_f, {
      apply: function(target, thisArg, al) {
        const r = Reflect.apply(target, thisArg, al);
        r.then(function(res) {
          try {
            const url = al[0] instanceof Request ? al[0].url : String(al[0] != null ? al[0] : "");
            const ct  = (res.headers && res.headers.get) ? (res.headers.get("content-type") || "") : "";
            if (isK(url) && ct.indexOf("json") !== -1) {
              res.clone().json().then(function(d) { emit(d, "fetch"); }).catch(function() {});
            }
          } catch(e) {}
        }).catch(function() {});
        return r;
      }
    });
  } catch(e) {}

  // XHR
  try {
    const _xo = XMLHttpRequest.prototype.open;
    const _xs = XMLHttpRequest.prototype.send;
    const _xu = new WeakMap();
    XMLHttpRequest.prototype.open = new Proxy(_xo, {
      apply: function(target, th, args) {
        _xu.set(th, String(args[1] != null ? args[1] : ""));
        return Reflect.apply(target, th, args);
      }
    });
    XMLHttpRequest.prototype.send = new Proxy(_xs, {
      apply: function(target, th, args) {
        const url = _xu.get(th) || "";
        if (url && isK(url)) {
          th.addEventListener("load", function() {
            try {
              const ct = (th.getResponseHeader && th.getResponseHeader("content-type")) || "";
              if (ct.indexOf("json") === -1) return;
              const d = tryJson(th.responseText);
              if (d) emit(d, "xhr");
            } catch(e) {}
          });
        }
        return Reflect.apply(target, th, args);
      }
    });
  } catch(e) {}

  // WebSocket — captura nuevas conexiones con Proxy
  try {
    const _W = window.WebSocket;
    window.WebSocket = new Proxy(_W, {
      construct: function(Target, args) {
        const ws = new Target(...args);
        if (args[0] && KRE.test(String(args[0]))) {
          ws.addEventListener("message", function(ev) {
            try { const d = tryJson(ev.data); if (d) emit(d, "ws"); } catch(e) {}
          });
        }
        return ws;
      },
      get: function(target, prop, receiver) { return Reflect.get(target, prop, receiver); }
    });
  } catch(e) {}
}

function injectIntoTab(tabId) {
  // allFrames: true — hooks de red en TODOS los frames (iframes del juego en vivo incluidos)
  chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: true },
    world: "MAIN",
    func: kahootNetworkHooks
  }).catch(function() {});
}

// Inyectar en carga completa Y en cambios de URL (navegación SPA via history.pushState)
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  var isComplete  = changeInfo.status === "complete";
  var isUrlChange = typeof changeInfo.url === "string" && changeInfo.url.length > 0;
  if (!isComplete && !isUrlChange) return;
  try {
    var url = tab.url || changeInfo.url || "";
    if (!url) return;
    if (/kahoot\.(it|com)/.test(new URL(url).hostname)) {
      injectIntoTab(tabId);
    }
  } catch(e) {}
});

// Inyectar en pestañas de Kahoot ya abiertas cuando se recarga la extensión
chrome.tabs.query({ url: ["https://*.kahoot.it/*", "https://*.kahoot.com/*"] }, function(tabs) {
  tabs.forEach(function(tab) { if (tab.id) injectIntoTab(tab.id); });
});

// El content script (ISOLATED world) pide inyección vía mensaje
chrome.runtime.onMessage.addListener(function(msg, sender) {
  if (msg && msg.type === "ko_inject" && sender.tab && sender.tab.id) {
    injectIntoTab(sender.tab.id);
  }
});

chrome.runtime.onInstalled.addListener(function() {
  console.info("[KahootObserver] v6 instalada.");
});
