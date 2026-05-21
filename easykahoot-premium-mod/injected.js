"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// KAHOOT OBSERVER v9.0  —  ISOLATED world
//
// Los hooks de red los inyecta background.js via chrome.scripting.executeScript
// (bypasea CSP, corre en MAIN world sin interferir con la init de Kahoot).
// Este script (ISOLATED) maneja: overlay, teclado, y recibe datos via CustomEvent.
// ═══════════════════════════════════════════════════════════════════════════

// ── CSS ───────────────────────────────────────────────────────────────────
const CSS = `
#ko-overlay {
  all:initial;
  position:fixed!important; top:16px!important; right:16px!important;
  z-index:2147483647!important; width:320px!important;
  max-height:85vh!important; min-height:44px!important;
  display:flex!important; flex-direction:column!important;
  overflow:hidden!important; box-sizing:border-box!important;
  background:#1e1e2e!important; color:#cdd6f4!important;
  border:1px solid #45475a!important; border-radius:10px!important;
  box-shadow:0 12px 32px rgba(0,0,0,.6)!important;
  font-family:"Segoe UI",system-ui,sans-serif!important;
  font-size:13px!important; line-height:1.5!important;
  pointer-events:auto!important; transition:max-height .2s ease!important;
}
#ko-overlay.ko-min { max-height:44px!important; }
#ko-overlay.ko-hidden { display:none!important; }
#ko-overlay.ko-min .ko-body,
#ko-overlay.ko-min .ko-footer { display:none!important; }
#ko-overlay.ko-min .ko-header { border-radius:10px!important; border-bottom:none!important; }
#ko-overlay .ko-header {
  display:flex!important; align-items:center!important; justify-content:space-between!important;
  height:44px!important; padding:0 10px!important; flex-shrink:0!important;
  background:#313244!important; border-radius:10px 10px 0 0!important;
  border-bottom:1px solid #45475a!important; box-sizing:border-box!important;
  pointer-events:auto!important; user-select:none!important; cursor:move!important;
}
#ko-overlay .ko-title { font-weight:700!important; font-size:13px!important; color:#89b4fa!important; }
#ko-overlay .ko-controls { display:flex!important; gap:5px!important; }
#ko-overlay .ko-btn-min, #ko-overlay .ko-btn-close {
  display:flex!important; align-items:center!important; justify-content:center!important;
  width:26px!important; height:26px!important; border-radius:50%!important;
  border:none!important; outline:none!important; font-size:16px!important;
  cursor:pointer!important; pointer-events:auto!important; line-height:1!important;
  font-family:inherit!important; transition:background .15s!important; user-select:none!important;
}
#ko-overlay .ko-btn-min   { background:rgba(137,180,250,.2)!important; color:#89b4fa!important; }
#ko-overlay .ko-btn-min:hover   { background:rgba(137,180,250,.35)!important; }
#ko-overlay .ko-btn-close { background:rgba(243,139,168,.2)!important; color:#f38ba8!important; }
#ko-overlay .ko-btn-close:hover { background:rgba(243,139,168,.35)!important; }
#ko-overlay .ko-body {
  flex:1!important; overflow-y:auto!important; overscroll-behavior:contain!important;
  padding:10px 12px!important; box-sizing:border-box!important;
  display:flex!important; flex-direction:column!important; pointer-events:auto!important;
}
#ko-overlay .ko-body::-webkit-scrollbar { width:4px!important; }
#ko-overlay .ko-body::-webkit-scrollbar-thumb { background:#45475a!important; border-radius:2px!important; }
#ko-overlay .ko-answer-box {
  display:flex!important; flex-direction:column!important; align-items:center!important;
  background:linear-gradient(135deg,#1a472a,#2d6a3f)!important;
  border:2px solid #a6e3a1!important; border-radius:8px!important;
  padding:10px 12px!important; margin-bottom:8px!important;
  width:100%!important; box-sizing:border-box!important;
}
#ko-overlay .ko-answer-lbl {
  font-size:9px!important; font-weight:800!important; letter-spacing:.12em!important;
  color:#a6e3a1!important; text-transform:uppercase!important; margin-bottom:4px!important;
}
#ko-overlay .ko-answer-val {
  font-size:20px!important; font-weight:800!important; color:#a6e3a1!important;
  text-align:center!important; line-height:1.3!important; word-break:break-word!important;
}
#ko-overlay .ko-q-preview {
  font-size:11px!important; color:#7f849c!important; font-style:italic!important;
  line-height:1.4!important; margin-bottom:6px!important; word-break:break-word!important;
}
#ko-overlay .ko-choices { display:flex!important; flex-direction:column!important; gap:3px!important; }
#ko-overlay .ko-choice {
  display:flex!important; align-items:center!important; gap:5px!important;
  font-size:12px!important; padding:3px 6px!important; border-radius:5px!important;
  box-sizing:border-box!important; word-break:break-word!important;
}
#ko-overlay .ko-ok {
  background:rgba(166,227,161,.12)!important; border:1px solid rgba(166,227,161,.3)!important;
  color:#a6e3a1!important; font-weight:600!important;
}
#ko-overlay .ko-no { color:#585b70!important; }
#ko-overlay .ko-ltr { font-size:10px!important; font-weight:700!important; min-width:14px!important; }
#ko-overlay .ko-ok .ko-ltr { color:#a6e3a1!important; }
#ko-overlay .ko-no .ko-ltr { color:#45475a!important; }
#ko-overlay .ko-chk { min-width:14px!important; color:#a6e3a1!important; font-weight:700!important; }
#ko-overlay .ko-dot { min-width:14px!important; color:#45475a!important; }
#ko-overlay .ko-ctxt { flex:1!important; font-size:12px!important; }
#ko-overlay .ko-wait {
  font-size:12px!important; color:#585b70!important; font-style:italic!important;
  text-align:center!important; padding:8px 0!important;
}
#ko-overlay .ko-fb {
  font-size:11px!important; font-weight:600!important; color:#a6e3a1!important;
  text-align:center!important; opacity:0!important; min-height:16px!important;
  transition:opacity .3s!important;
}
#ko-overlay .ko-fb.show { opacity:1!important; }
#ko-overlay .ko-footer {
  flex-shrink:0!important; display:flex!important; align-items:center!important;
  gap:5px!important; flex-wrap:wrap!important; padding:6px 12px!important;
  border-top:1px solid #313244!important; background:#181825!important;
  border-radius:0 0 10px 10px!important; box-sizing:border-box!important;
}
#ko-overlay .ko-footer kbd {
  font-family:"Segoe UI",monospace!important; font-size:10px!important;
  color:#cdd6f4!important; background:#313244!important;
  border:1px solid #45475a!important; border-radius:3px!important; padding:1px 5px!important;
}
#ko-overlay .ko-footer span { font-size:10px!important; color:#585b70!important; }
#ko-overlay .ko-footer .sep { color:#313244!important; }
#ko-overlay .ko-status { margin-left:auto!important; color:#6c7086!important; font-style:italic!important; }
`;

// ── Estado ────────────────────────────────────────────────────────────────
const qList = [];
let cur = null, qIdx = -1;
let ov  = null, obs = null, dbt = null;
let mini = false, hid = false, gotNet = false;
let _scanThrottle = 0; // timestamp último scanDOM completo

// Estado CometD: espera combines de alternatives + correctAnswers
const _pendAlt = {}; // questionIndex → {question, alts[]}

// Texto del DOM del iframe hijo (create.kahoot.it/solo embeds the game in an <iframe>).
// Poblado por postMessage relay desde el content script que corre dentro del iframe.
var _iframeBodyText = "";
var _iframeTextDbt  = null;

// ── Utils ─────────────────────────────────────────────────────────────────
const esc  = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const norm = s => s.toLowerCase().replace(/\s+/g," ").trim();

// Normalización agresiva: minúsculas + NFD → strip acentos + quita puntuación.
// Evita fallos por NFC vs NFD (é como 1 codepoint vs e+´ como 2 codepoints).
function normA(s) {
  if (typeof s !== "string") s = String(s || "");
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")  // é→e, ñ→n, á→a …
    .replace(/[^a-z0-9\s]/g, " ")                       // quita puntuación
    .replace(/\s+/g, " ").trim();
}

function tryJson(s) {
  if (typeof s !== "string" || s.length < 5) return null;
  const t = s.trim();
  if (t[0] !== "{" && t[0] !== "[") return null;
  try { return JSON.parse(t); } catch(e) { return null; }
}

// ── Extracción genérica (múltiples formatos Kahoot) ───────────────────────
function exAll(d, out, depth) {
  out   = out   || [];
  depth = depth || 0;
  if (depth > 15 || !d) return out;
  if (Array.isArray(d)) { d.forEach(function(x) { exAll(x, out, depth + 1); }); return out; }
  if (typeof d !== "object") return out;

  var qt = String(d.question || d.questionText || d.questionStem || d.title || d.text || d.name || "");

  // Formato A: array de choices/answers/options/alternatives con campo "correct"
  var arr = d.choices || d.answers || d.options || null;
  if (Array.isArray(arr) && arr.length >= 2 && arr.some(function(c) { return c && typeof c === "object" && "correct" in c; })) {
    var chA = arr.map(function(c) {
      return { text: String(c.answer || c.text || c.choice || c.label || c.value || ""), correct: Boolean(c.correct) };
    });
    if (chA.some(function(c) { return c.text.trim(); })) { out.push({ question: qt, choices: chA }); return out; }
  }

  // Formato B: índice numérico correcto en el padre
  var ci = (d.correctAnswerIndex != null ? d.correctAnswerIndex : (d.correctChoice != null ? d.correctChoice : null));
  if (arr && typeof ci === "number" && ci >= 0 && ci < arr.length) {
    var chB = arr.map(function(c, i) {
      return { text: typeof c === "string" ? c : String(c.answer || c.text || c.choice || ""), correct: i === ci };
    });
    if (chB.some(function(c) { return c.text.trim(); })) { out.push({ question: qt, choices: chB }); return out; }
  }

  // Formato C/D: correctAnswers array (índices) + choices o alternatives
  var caArr = d.correctAnswers || d.correctChoices || null;
  var srcArr = d.choices || d.answers || d.options || d.alternatives || null;
  if (Array.isArray(caArr) && Array.isArray(srcArr) && srcArr.length >= 2) {
    var idxSet = new Set(caArr);
    var chC = srcArr.map(function(c, i) {
      return { text: typeof c === "string" ? c : String(c.answer || c.text || c.choice || ""), correct: idxSet.has(i) };
    });
    if (chC.some(function(c) { return c.text.trim(); })) { out.push({ question: qt, choices: chC }); return out; }
  }

  // Recursar — también intentar parsear strings que parezcan JSON (CometD envía JSON-dentro-de-JSON)
  var vals = Object.values(d);
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v && typeof v === "object") exAll(v, out, depth + 1);
    else if (typeof v === "string") { var p = tryJson(v); if (p) exAll(p, out, depth + 1); }
  }
  return out;
}

// ── Procesamiento de mensajes de red ──────────────────────────────────────
// Kahoot usa protocolo CometD: la pregunta y la respuesta correcta llegan
// en mensajes SEPARADOS. _pendAlt guarda las alternativas hasta recibir correctAnswers.
//
// Estructura CometD: [{channel:"/service/player", data:{content:"JSON_STRING"}}]
// Hay que desempaquetar .data y luego .content antes de llegar a los datos reales.
function processMsg(d) {
  if (!d || typeof d !== "object") return;

  // Capa 1: envelope CometD — { channel, data: { content | alternatives | ... } }
  if (d.data && typeof d.data === "object") {
    processMsg(d.data);
    return;
  }

  // Capa 2: content como JSON string (Kahoot empaqueta el payload así)
  if (typeof d.content === "string") {
    var inner = tryJson(d.content);
    if (inner) { processMsg(inner); return; }
  }

  // Fase 1: inicio de pregunta — tiene alternatives pero NO correctAnswers
  if (Array.isArray(d.alternatives) && d.alternatives.length >= 2 && !d.correctAnswers) {
    var qi = d.questionIndex != null ? d.questionIndex : 0;
    var qtext = d.question || d.questionStem || d.title || "";
    var alts = d.alternatives.map(function(a) {
      return typeof a === "string" ? a : String(a.answer || a.text || a.value || "");
    });
    _pendAlt[qi] = { question: qtext, alts: alts };
    console.debug("[KO] pending alts Q" + qi + ":", alts);
    // Mostrar las opciones en el overlay (sin marcar correcta aún)
    renderWaiting(qtext, alts);
    return;
  }

  // Fase 2: reveal — correctAnswers llega en mensaje separado
  if (Array.isArray(d.correctAnswers)) {
    var qi2 = d.questionIndex != null ? d.questionIndex : 0;
    var pending = _pendAlt[qi2];

    if (pending && pending.alts.length >= 2) {
      var correctSet = new Set(d.correctAnswers);
      storeQ([{
        question: pending.question,
        choices: pending.alts.map(function(a, i) { return { text: a, correct: correctSet.has(i) }; })
      }], "cometd");
      delete _pendAlt[qi2];
      return;
    }

    // Si alternatives y correctAnswers llegan juntos (algunos formatos)
    if (Array.isArray(d.alternatives) && d.alternatives.length >= 2) {
      var correctSet2 = new Set(d.correctAnswers);
      storeQ([{
        question: d.question || d.questionStem || "",
        choices: d.alternatives.map(function(a, i) {
          return { text: typeof a === "string" ? a : String(a.answer || a.text || ""), correct: correctSet2.has(i) };
        })
      }], "cometd-inline");
      return;
    }
  }

  // Extracción genérica (REST API, formatos con campo "correct" por ítem, etc.)
  var qs = exAll(d);
  if (qs.length) storeQ(qs, "generic");
}

// ── Almacenamiento ────────────────────────────────────────────────────────

// Firma única por pregunta: texto normalizado + opciones ordenadas.
// Incluir el texto de la pregunta evita deduplicar dos preguntas distintas
// que por casualidad tengan las mismas opciones.
function makeSig(q) {
  return normA(q.question || "").slice(0, 60) + "\x00" +
    q.choices.map(function(c) { return norm(c.text); }).sort().join("|");
}

function storeQ(qs, src) {
  var before = qList.length;
  for (var i = 0; i < qs.length; i++) {
    var q = qs[i];
    if (!Array.isArray(q.choices) || q.choices.length < 2) continue;
    var sig = makeSig(q);
    if (!sig.replace(/[\x00|]/g, "").trim()) continue;
    if (!qList.some(function(x) { return makeSig(x) === sig; })) {
      qList.push(q);
    }
  }
  if (qList.length > before) {
    gotNet = true;
    console.debug("[KO] storeQ(" + src + "): +" + (qList.length - before) + " → " + qList.length);
    updateStatus();
  }

  if (src === "cometd" || src === "cometd-inline") {
    // CometD = pregunta activa en el juego en vivo por definición.
    // No necesitamos leer el DOM — el dato de red ya nos dice qué está en pantalla.
    var target = null;
    if (qList.length > before) {
      target = qList[qList.length - 1];          // recién añadida
    } else if (qs.length) {
      // Ya existía (dedup) — buscarla por firma
      var s0 = makeSig(qs[0]);
      for (var k = qList.length - 1; k >= 0; k--) {
        if (makeSig(qList[k]) === s0) { target = qList[k]; break; }
      }
    }
    if (target) { qIdx = qList.indexOf(target); render(target); }
  } else if (qList.length > before) {
    // Para datos de REST/inline: intentar match por DOM
    var found = findMatch();
    if (found && found !== cur) { render(found); qIdx = qList.indexOf(found); }
  }
}

// ── Botones para autoAnswer ───────────────────────────────────────────────
const BTN_SEL = [
  "[data-functional-selector^='answer']","[data-functional-selector^='choice']",
  "[data-testid^='answer']","[data-testid^='choice']",
  ".choice-card","[class*='answerCard']","[class*='answerTile']",
  "[class*='answer__']","[class*='Answer__']",
  "[class*='answerBox']","[class*='AnswerBox']",
  "[class*='choiceBox']","[class*='ChoiceBox']",
].join(",");

function isVisible(el) {
  if (!el) return false;
  try { var cs = getComputedStyle(el); return cs.display!=="none"&&cs.visibility!=="hidden"&&parseFloat(cs.opacity)>0.01; } catch(e) { return false; }
}

function getVisibleBtns() {
  var btns = Array.from(document.querySelectorAll(BTN_SEL)).filter(function(b) {
    return (!ov||!ov.contains(b)) && isVisible(b);
  });
  if (!btns.length) {
    btns = Array.from(document.querySelectorAll("button,[role='button']")).filter(function(b) {
      if ((ov&&ov.contains(b))||!isVisible(b)) return false;
      var t = (b.innerText||b.textContent||"").trim();
      return t.length >= 2 && t.length <= 150 && t.split(" ").length <= 30;
    }).slice(0, 6);
  }
  return btns;
}

// ── Matching ──────────────────────────────────────────────────────────────
// Usa elementFromPoint() para leer solo los elementos pintados visualmente
// en pantalla — inmune a elementos React obsoletos o paneles secundarios.
// document.body.innerText incluía elementos ocultos/stale de transiciones React;
// elementFromPoint solo devuelve el elemento visible en esa posición de viewport.

var _pageHash = "";       // hash para detectar cambio de pregunta
var _seqLastAdvance = 0;  // timestamp del último avance secuencial

// Devuelve el texto del elemento pintado en (x, y), subiendo hasta 8 niveles
// para encontrar un contenedor con entre minLen y maxLen caracteres.
function textAt(x, y, minLen, maxLen) {
  minLen = minLen == null ? 2 : minLen;
  maxLen = maxLen == null ? 400 : maxLen;
  try {
    var el = document.elementFromPoint(x, y);
    if (!el || el === document.documentElement || el === document.body) return "";
    if (ov && ov.contains(el)) return "";
    for (var d = 0; d < 8 && el && el !== document.body; d++) {
      var t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (t.length >= minLen && t.length <= maxLen) return t;
      el = el.parentElement;
    }
    return "";
  } catch(e) { return ""; }
}

// Lee la pregunta activa — muestrea columna central en toda la altura del viewport.
// Con imagen: la pregunta se desplaza a ~55-65%; sin imagen: está en ~20-40%.
function getScreenQuestion() {
  var W = window.innerWidth, H = window.innerHeight;
  var pts = [
    [W * 0.50, H * 0.22], [W * 0.50, H * 0.28],
    [W * 0.40, H * 0.30], [W * 0.60, H * 0.30],
    [W * 0.50, H * 0.38],
    [W * 0.50, H * 0.50], [W * 0.50, H * 0.57],
    [W * 0.40, H * 0.60], [W * 0.50, H * 0.63], [W * 0.60, H * 0.60],
  ];
  var best = "";
  for (var i = 0; i < pts.length; i++) {
    var t = textAt(pts[i][0], pts[i][1], 10, 400);
    if (t.length > best.length) best = t;
  }
  return best;
}

// Lee los tiles de respuesta en el cuadrante inferior.
// Kahoot: Triángulo/Rojo=A (sup-izq), Diamante/Azul=B (sup-der),
//         Círculo/Amarillo=C (inf-izq), Cuadrado/Verde=D (inf-der)
function getScreenChoices() {
  var W = window.innerWidth, H = window.innerHeight;
  return [
    textAt(W * 0.25, H * 0.70, 1, 150),
    textAt(W * 0.75, H * 0.70, 1, 150),
    textAt(W * 0.25, H * 0.80, 1, 150),
    textAt(W * 0.75, H * 0.80, 1, 150),
    textAt(W * 0.25, H * 0.88, 1, 150),
    textAt(W * 0.75, H * 0.88, 1, 150),
  ];
}

function findMatch() {
  if (!qList.length || !document.body) return null;

  // Estrategia 1: lectura por coordenadas (funciona en juego en vivo en el top frame)
  var screenQ = normA(getScreenQuestion());
  var screenC = getScreenChoices().map(function(t) { return normA(t); });
  var validC  = screenC.filter(function(t) { return t.length > 2; });
  var useCoords = screenQ.length >= 5 || validC.length >= 2;

  // Estrategia 2: texto del iframe hijo (create.kahoot.it/solo — el juego está en un <iframe>)
  // El content script dentro del iframe envía su innerText via postMessage.
  var ifrTxt = (_iframeBodyText && _iframeBodyText.length > 10) ? _iframeBodyText : "";

  // Estrategia 3: innerText local (último recurso para layouts no cubiertos por coords)
  var bodyTxt = "";
  if (!useCoords && !ifrTxt) {
    try { bodyTxt = normA((document.body.innerText || "").slice(0, 3000)); } catch(e) {}
  }

  var searchTxt = ifrTxt || bodyTxt;  // texto plano para estrategias 2 y 3

  console.debug("[KO] findMatch coords=" + useCoords +
    " screenQ=" + screenQ.slice(0, 50) +
    " iframe=" + ifrTxt.slice(0, 40));

  if (!useCoords && searchTxt.length < 10) return null;

  var best = null, bestScore = 0, scores = [];
  for (var i = 0; i < qList.length; i++) {
    var q = qList[i];
    var score = 0;

    if (useCoords) {
      // +6 si la pregunta aparece en los puntos muestreados
      if (q.question && screenQ.length >= 5) {
        var qn = normA(q.question).slice(0, 80);
        if (qn.length >= 5 && (screenQ.indexOf(qn) !== -1 || qn.indexOf(screenQ.slice(0, 70)) !== -1)) score += 6;
      }
      // +3 por cada tile visible que coincide con una opción
      for (var j = 0; j < q.choices.length; j++) {
        var cn = normA(q.choices[j].text).slice(0, 50);
        if (cn.length < 3) continue;
        for (var k = 0; k < screenC.length; k++) {
          if (screenC[k].length >= 3 && screenC[k].indexOf(cn) !== -1) { score += 3; break; }
        }
      }
    } else {
      // Texto plano (iframe relay o body local)
      if (q.question) {
        var qn2 = normA(q.question).slice(0, 80);
        if (qn2.length >= 5 && searchTxt.indexOf(qn2) !== -1) score += 4;
      }
      for (var j2 = 0; j2 < q.choices.length; j2++) {
        var cn2 = normA(q.choices[j2].text).slice(0, 50);
        if (cn2.length >= 3 && searchTxt.indexOf(cn2) !== -1) score += 2;
      }
    }

    scores.push(score);
    if (score > bestScore) { bestScore = score; best = q; }
  }

  console.debug("[KO] findMatch best=" + bestScore +
    (best ? " q=" + normA(best.question || "").slice(0, 50) : " (none)") +
    " top3=" + scores.slice().sort(function(a, b) { return b - a; }).slice(0, 3).join(","));

  return bestScore >= 4 ? best : null;
}

// ── Render ────────────────────────────────────────────────────────────────
const LTR = ["A","B","C","D","E","F"];

// Muestra las opciones sin marcar cuál es correcta (esperando reveal de CometD)
function renderWaiting(question, alts) {
  if (!ov) return;
  var qshort = question.length > 120 ? question.slice(0,120)+"…" : question;
  var rows = alts.map(function(a, i) {
    return '<div class="ko-choice ko-no">' +
      '<span class="ko-ltr">' + (LTR[i]||(i+1)) + '</span>' +
      '<span class="ko-dot">?</span>' +
      '<span class="ko-ctxt">' + esc(a) + '</span></div>';
  }).join("");
  var block = ov.querySelector(".ko-block");
  if (block) block.innerHTML =
    '<div class="ko-answer-box" style="background:linear-gradient(135deg,#1e2a3a,#1e3a5a)!important;border-color:#89b4fa!important">' +
    '<div class="ko-answer-lbl" style="color:#89b4fa!important">ESPERANDO REVEAL…</div>' +
    '<div class="ko-answer-val" style="color:#89b4fa!important;font-size:14px!important">' + esc(qshort||"Pregunta en curso") + '</div>' +
    '</div>' +
    (qshort ? '' : '') +
    '<div class="ko-choices">' + rows + '</div>';
  updateStatus();
}

function render(q) {
  if (!ov || !q) return;
  cur = q;
  var ctext = q.choices.filter(function(c){return c.correct;}).map(function(c){return c.text;}).join(" / ") || "—";
  var qshort = q.question.length > 120 ? q.question.slice(0,120)+"…" : q.question;
  var rows = q.choices.map(function(c, i) {
    return '<div class="ko-choice ' + (c.correct?"ko-ok":"ko-no") + '">' +
      '<span class="ko-ltr">' + (LTR[i]||(i+1)) + '</span>' +
      (c.correct ? '<span class="ko-chk">✓</span>' : '<span class="ko-dot">·</span>') +
      '<span class="ko-ctxt">' + esc(c.text) + '</span></div>';
  }).join("");
  var block = ov.querySelector(".ko-block");
  if (block) block.innerHTML =
    '<div class="ko-answer-box"><div class="ko-answer-lbl">RESPUESTA CORRECTA</div><div class="ko-answer-val">' + esc(ctext) + '</div></div>' +
    '<div class="ko-q-preview">' + esc(qshort) + '</div>' +
    '<div class="ko-choices">' + rows + '</div>';
  updateStatus();
}

function feedback(msg) {
  var el = ov && ov.querySelector(".ko-fb");
  if (!el) return;
  el.textContent = msg; el.classList.add("show");
  setTimeout(function() { el.classList.remove("show"); }, 2200);
}

function updateStatus() {
  var el = ov && ov.querySelector(".ko-status");
  if (el) el.textContent = "Q:" + qList.length + (gotNet ? "" : " (sin red)");
}

// ── Controles ─────────────────────────────────────────────────────────────
function toggleMin() {
  if (!ov) return;
  mini = !mini; ov.classList.toggle("ko-min", mini);
  var b = ov.querySelector(".ko-btn-min"); if (b) b.textContent = mini ? "+" : "−";
}
function toggleHide() {
  if (!ov) return;
  if (hid) {
    // Mostrar: quitar ocultamiento Y expandir si estaba minimizado
    hid = false;
    ov.classList.remove("ko-hidden");
    if (mini) {
      mini = false;
      ov.classList.remove("ko-min");
      var b = ov.querySelector(".ko-btn-min");
      if (b) b.textContent = "−";
    }
  } else {
    // Ocultar (desde cualquier estado: normal o minimizado)
    hid = true;
    ov.classList.add("ko-hidden");
  }
}
function teardown() {
  if (obs) { obs.disconnect(); obs = null; }
  if (ov)  { ov.remove();     ov  = null; }
}
function autoAnswer() {
  if (!cur) { feedback("Sin pregunta activa"); return; }
  var idx = cur.choices.findIndex(function(c) { return c.correct; });
  if (idx < 0) { feedback("Sin respuesta correcta"); return; }
  var btns = getVisibleBtns();
  if (btns[idx]) { btns[idx].click(); feedback("✓ Opción " + (LTR[idx]||(idx+1)) + " respondida"); }
  else feedback("Botón no encontrado");
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS (document_start, ISOLATED world)
// ═══════════════════════════════════════════════════════════════════════════

// Recibir datos de los hooks (inyectados en MAIN world por background.js)
// detail llega como JSON string para cruzar el boundary MAIN→ISOLATED sin problemas
window.addEventListener("__ko__", function(e) {
  try {
    if (!e.detail) return;
    var raw = typeof e.detail === "string" ? tryJson(e.detail) : (e.detail && e.detail.d);
    if (!raw) return;
    if (Array.isArray(raw)) {
      raw.forEach(function(item) { processMsg(item); });
    } else {
      processMsg(raw);
    }
  } catch(err) {}
});

// Tecla Alt+H — funciona tanto cuando el top frame tiene foco
// como cuando el juego dentro del iframe tiene foco (el iframe reenvía via postMessage).
window.addEventListener("keydown", function koKeys(e) {
  // En iframes el relay (window.load) se encarga — si actuamos aquí primero
  // stopImmediatePropagation mataría ese listener antes de que pueda correr.
  if (window !== window.top) return;
  var isHide = e.altKey && (e.code === "KeyH" || e.key === "h" || e.key === "H");
  if (!isHide) return;
  e.stopImmediatePropagation(); e.preventDefault();
  toggleHide();
}, true);

window.addEventListener("click", function koClick(e) {
  if (!ov) return;
  var t = e.target;
  while (t && t !== ov) {
    if (t.tagName === "BUTTON" && ov.contains(t)) {
      e.stopImmediatePropagation();
      if (t.classList.contains("ko-btn-min"))   { e.preventDefault(); toggleMin();  }
      if (t.classList.contains("ko-btn-close")) { e.preventDefault(); teardown();   }
      return;
    }
    t = t.parentElement;
  }
}, true);

// ═══════════════════════════════════════════════════════════════════════════
// WINDOW.LOAD — overlay + observers + pedir inyección al background
// ═══════════════════════════════════════════════════════════════════════════

function initOv() {
  if (ov && document.contains(ov)) return;
  if (!document.getElementById("ko-css")) {
    var s = document.createElement("style"); s.id = "ko-css"; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  ov = document.createElement("div"); ov.id = "ko-overlay";
  ov.innerHTML =
    '<div class="ko-header"><span class="ko-title">🎯 Kahoot Observer</span>' +
    '<div class="ko-controls">' +
    '<button class="ko-btn-min" title="Minimizar">−</button>' +
    '<button class="ko-btn-close" title="Cerrar">✕</button>' +
    '</div></div>' +
    '<div class="ko-body"><div class="ko-block"><p class="ko-wait">Esperando datos de red…</p></div><div class="ko-fb"></div></div>' +
    '<div class="ko-footer">' +
    '<kbd>Alt+H</kbd><span>ocultar / mostrar</span><span class="ko-status">Q:0</span></div>';
  document.documentElement.appendChild(ov);
  // Resync visibility and minimized state in case the overlay was recreated
  // while hid/mini were already true (DOM was removed by Kahoot React, state survived)
  if (hid)  ov.classList.add("ko-hidden");
  if (mini) { ov.classList.add("ko-min"); var b = ov.querySelector(".ko-btn-min"); if (b) b.textContent = "+"; }
  ov.addEventListener("pointerdown", function(e) { e.stopPropagation(); });
  ov.addEventListener("wheel",       function(e) { e.stopPropagation(); }, { passive: true });
  ov.addEventListener("click",       function(e) { if (!e.target.closest(".ko-btn-min,.ko-btn-close")) e.stopPropagation(); });
  updateStatus();
}

function scanDOM() {
  if (!ov || !document.contains(ov)) { initOv(); return; }
  if (!qList.length) return;
  var now = Date.now();
  if (now - _scanThrottle < 250) return;
  _scanThrottle = now;

  // Hash de la página: prefiere texto de coordenadas, luego iframe relay, luego body
  function pageHash() {
    var sq = normA(getScreenQuestion());
    if (sq.length > 5) return sq.slice(0, 80);
    if (_iframeBodyText && _iframeBodyText.length > 10) return _iframeBodyText.slice(0, 80);
    try { return normA((document.body.innerText || "").slice(0, 300)).slice(0, 80); } catch(e) { return ""; }
  }

  // Intento 1: matching por texto visible (coordenadas, iframe relay, o body)
  var found = findMatch();
  if (found && found !== cur) {
    qIdx = qList.indexOf(found);
    render(found);
    _pageHash = pageHash();
    return;
  }

  // Intento 2: mostrar algo si aún no hay nada en el overlay
  if (!cur && qList.length > 0) {
    qIdx = 0; render(qList[0]);
    _pageHash = pageHash();
    return;
  }

  // Intento 3: fallback secuencial — si el contenido de pantalla cambió
  // y findMatch() no pudo hacer match, avanzar al siguiente
  var hash = pageHash();
  if (hash !== _pageHash && hash.length > 10 && now - _seqLastAdvance > 1500) {
    _pageHash = hash;
    _seqLastAdvance = now;
    var next = (qIdx + 1) % qList.length;
    console.debug("[KO] scanDOM: fallback secuencial qIdx " + qIdx + " → " + next);
    qIdx = next;
    render(qList[qIdx]);
  }
}

function startObs() {
  if (obs) obs.disconnect();
  obs = new MutationObserver(function() { clearTimeout(dbt); dbt = setTimeout(scanDOM, 150); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

function scanInlineData() {
  var nd = document.getElementById("__NEXT_DATA__");
  if (nd) { var qs = exAll(tryJson(nd.textContent) || {}); if (qs.length) { storeQ(qs, "inline:next"); return; } }
  var scripts = document.querySelectorAll('script[type="application/json"]');
  for (var i = 0; i < scripts.length; i++) {
    var qs2 = exAll(tryJson(scripts[i].textContent) || {});
    if (qs2.length) storeQ(qs2, "inline:script");
  }
}

window.addEventListener("load", function koInit() {

  // ── IFRAME BRANCH ─────────────────────────────────────────────────────────
  // create.kahoot.it/solo embeds the game in an <iframe>.
  // With all_frames:true this script also runs inside that iframe.
  // Here we relay DOM text and network events to the parent frame where the
  // overlay lives, then bail out — no overlay in child frames.
  if (window !== window.top) {
    // Todos los mensajes van a window.TOP (no window.parent) para que atraviesen
    // cualquier profundidad de iframes anidados sin depender de un relay intermedio.
    var _ifDbt = null;
    function relayText() {
      try {
        var t = normA((document.body.innerText || "").slice(0, 1200));
        if (t.length > 10) window.top.postMessage({ __ko_txt: t }, "*");
      } catch(e) {}
    }
    // Eventos de red desde MAIN world → top frame
    window.addEventListener("__ko__", function(e) {
      try { window.top.postMessage({ __ko_evt: e.detail }, "*"); } catch(_) {}
    });
    // Alt+H desde cualquier nivel de iframe → top frame (donde vive el overlay)
    window.addEventListener("keydown", function(e) {
      var isHide = e.altKey && (e.code === "KeyH" || e.key === "h" || e.key === "H");
      if (!isHide) return;
      e.stopImmediatePropagation(); e.preventDefault();
      try { window.top.postMessage({ __ko_key: "toggleHide" }, "*"); } catch(_) {}
    }, true);
    // Texto DOM cada vez que el contenido del iframe cambia
    new MutationObserver(function() {
      clearTimeout(_ifDbt);
      _ifDbt = setTimeout(relayText, 180);
    }).observe(document.documentElement, { childList: true, subtree: true });
    relayText();
    console.debug("[KO] iframe relay activo (→ top):", location.href);
    return;
  }

  // ── TOP FRAME ─────────────────────────────────────────────────────────────

  // Recibir relays del iframe hijo
  window.addEventListener("message", function(e) {
    if (!e.data) return;
    // DOM text from child frame → use for matching
    if (typeof e.data.__ko_txt === "string" && e.data.__ko_txt.length > 10) {
      _iframeBodyText = e.data.__ko_txt;
      clearTimeout(_iframeTextDbt);
      _iframeTextDbt = setTimeout(scanDOM, 180);
    }
    // Network event relayed from child frame → process normally
    if (e.data.__ko_evt) {
      try {
        var raw = tryJson(e.data.__ko_evt);
        if (!raw) return;
        if (Array.isArray(raw)) raw.forEach(function(item) { processMsg(item); });
        else processMsg(raw);
      } catch(_) {}
    }
    // Keyboard shortcut relayed from child frame (iframe has focus when user plays)
    if (e.data.__ko_key === "toggleHide") toggleHide();
  });

  initOv();
  startObs();
  scanDOM();
  scanInlineData();

  try { chrome.runtime.sendMessage({ type: "ko_inject" }); } catch(e) {}

  setInterval(function() {
    if (!ov || !document.contains(ov)) initOv();
    scanDOM();
  }, 800);

  var _koLastHref = location.href;
  setInterval(function() {
    if (location.href === _koLastHref) return;
    _koLastHref = location.href;
    console.debug("[KO] URL change →", location.href);
    try { chrome.runtime.sendMessage({ type: "ko_inject" }); } catch(e) {}
    setTimeout(scanInlineData, 700);
  }, 600);

  console.debug("[KahootObserver] v10.0 ready");
}, false);
