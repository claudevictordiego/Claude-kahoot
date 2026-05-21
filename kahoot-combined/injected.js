"use strict";

// ── Config ────────────────────────────────────────────────────────────────
const AUTO_CLICK = true;

// ── State ─────────────────────────────────────────────────────────────────
// DOM-matching (v1)
const qList         = [];
let cur             = null;
let qIdx            = -1;
let ov              = null;
let obs             = null;
let dbt             = null;
let hid             = false;
let gotNet          = false;
let _scanThrottle   = 0;
const _pendAlt      = {};           // CometD: questionIndex → {question, alts[]}
var _iframeBodyText = "";
var _iframeTextDbt  = null;
var _pageHash       = "";
var _seqLastAdvance = 0;

// Pre-load cache (v2)
const cachedAnswers = {};           // gameBlockIndex → {type, correctChoices, answers, correctTexts}
const fetchedUUIDs  = new Set();
let lastProcessedQ  = -1;
let answerShownForQ = -1;

// ── CSS ───────────────────────────────────────────────────────────────────
const CSS = `
#ko-overlay {
  all: initial;
  position: fixed !important;
  top: 12px !important;
  right: 12px !important;
  z-index: 2147483647 !important;
  width: 320px !important;
  max-height: 85vh !important;
  overflow-y: auto !important;
  background: rgba(0,0,0,0.92) !important;
  color: #00ff88 !important;
  font: bold 15px Arial,sans-serif !important;
  padding: 14px 18px !important;
  border-radius: 10px !important;
  border: 2px solid #00ff88 !important;
  box-shadow: 0 0 25px rgba(0,255,136,0.55) !important;
  pointer-events: none !important;
  display: none !important;
  box-sizing: border-box !important;
}
#ko-overlay.ko-visible { display: block !important; }
#ko-overlay .ko-lbl {
  font-size: 11px !important; color: #aaa !important;
  margin-bottom: 5px !important; display: block !important;
}
#ko-overlay .ko-type {
  font-size: 12px !important; color: #ffdd00 !important;
  margin-bottom: 5px !important; display: block !important;
}
#ko-overlay .ko-answer {
  font-size: 18px !important; color: #00ff88 !important;
  margin-bottom: 10px !important; word-break: break-word !important;
  display: block !important;
}
#ko-overlay .ko-choices {
  margin: 0 !important; padding: 0 !important; list-style: none !important;
}
#ko-overlay .ko-choice {
  font-size: 13px !important; padding: 2px 0 !important;
  display: flex !important; gap: 6px !important; line-height: 1.4 !important;
}
#ko-overlay .ko-ok { color: #00ff88 !important; }
#ko-overlay .ko-no { color: #555 !important; }
#ko-overlay .ko-pending { color: #88aaff !important; font-style: italic !important; }
`;

// ── Utils ─────────────────────────────────────────────────────────────────
const esc  = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const norm = s => s.toLowerCase().replace(/\s+/g," ").trim();

function normA(s) {
  if (typeof s !== "string") s = String(s || "");
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function tryJson(s) {
  if (typeof s !== "string" || s.length < 5) return null;
  const t = s.trim();
  if (t[0] !== "{" && t[0] !== "[") return null;
  try { return JSON.parse(t); } catch(e) { return null; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LTR = ["A","B","C","D","E","F"];

// ── Multi-format question extractor (v1) ──────────────────────────────────
function exAll(d, out, depth) {
  out   = out   || [];
  depth = depth || 0;
  if (depth > 15 || !d) return out;
  if (Array.isArray(d)) { d.forEach(function(x) { exAll(x, out, depth + 1); }); return out; }
  if (typeof d !== "object") return out;

  var qt  = String(d.question || d.questionText || d.questionStem || d.title || d.text || d.name || "");
  var arr = d.choices || d.answers || d.options || null;

  // Formato A: choices con campo "correct"
  if (Array.isArray(arr) && arr.length >= 2 && arr.some(function(c) { return c && typeof c === "object" && "correct" in c; })) {
    var chA = arr.map(function(c) {
      return { text: String(c.answer || c.text || c.choice || c.label || c.value || ""), correct: Boolean(c.correct) };
    });
    if (chA.some(function(c) { return c.text.trim(); })) {
      out.push({ question: qt, type: d.type || d.gameBlockType || "quiz", choices: chA });
      return out;
    }
  }

  // Formato B: índice correcto numérico
  var ci = (d.correctAnswerIndex != null ? d.correctAnswerIndex : (d.correctChoice != null ? d.correctChoice : null));
  if (arr && typeof ci === "number" && ci >= 0 && ci < arr.length) {
    var chB = arr.map(function(c, i) {
      return { text: typeof c === "string" ? c : String(c.answer || c.text || c.choice || ""), correct: i === ci };
    });
    if (chB.some(function(c) { return c.text.trim(); })) {
      out.push({ question: qt, type: d.type || "quiz", choices: chB });
      return out;
    }
  }

  // Formato C/D: correctAnswers array + choices/alternatives
  var caArr  = d.correctAnswers || d.correctChoices || null;
  var srcArr = d.choices || d.answers || d.options || d.alternatives || null;
  if (Array.isArray(caArr) && Array.isArray(srcArr) && srcArr.length >= 2) {
    var idxSet = new Set(caArr);
    var chC = srcArr.map(function(c, i) {
      return { text: typeof c === "string" ? c : String(c.answer || c.text || c.choice || ""), correct: idxSet.has(i) };
    });
    if (chC.some(function(c) { return c.text.trim(); })) {
      out.push({ question: qt, type: d.type || "quiz", choices: chC });
      return out;
    }
  }

  // Recursar
  var vals = Object.values(d);
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v && typeof v === "object") exAll(v, out, depth + 1);
    else if (typeof v === "string") { var p = tryJson(v); if (p) exAll(p, out, depth + 1); }
  }
  return out;
}

// ── Pre-load cache (v2) ───────────────────────────────────────────────────

function cacheQuestion(q, idx) {
  if (cachedAnswers[idx]) return;
  const type    = q.type || q.gameBlockType || "quiz";
  const choices = q.choices || q.answerChoices || [];
  if (!choices.length) return;

  if (type === "jumble" || type === "ordering") {
    const order = new Array(choices.length);
    let valid = false;
    choices.forEach((c, i) => {
      const pos = typeof c.correct === "number" ? c.correct : parseInt(c.correct);
      if (!isNaN(pos)) { order[pos] = i; valid = true; }
    });
    if (valid) {
      cachedAnswers[idx] = { type, correctChoices: order, answers: choices.map(c => c.answer || c.text || "") };
    }
  } else {
    const correctIndices = choices.reduce((acc, c, i) => {
      if (c.correct === true || c.correct === 1) acc.push(i);
      return acc;
    }, []);
    if (correctIndices.length) {
      cachedAnswers[idx] = {
        type,
        correctChoices: correctIndices,
        answers: choices.map(c => c.answer || c.text || ""),
        correctTexts: q.correctAnswers || null,
      };
    }
  }
}

function deepCache(data, depth) {
  if (!data || typeof data !== "object" || depth > 7) return;
  if (data.questions && Array.isArray(data.questions)) {
    data.questions.forEach((q, i) => cacheQuestion(q, i));
  }
  if (data.kahoot) deepCache(data.kahoot, depth + 1);
  if (data.choices && Array.isArray(data.choices)) {
    const idx = data.gameBlockIndex ?? data.questionIndex;
    if (typeof idx === "number") cacheQuestion(data, idx);
  }
  for (const val of Object.values(data)) {
    if (val && typeof val === "object" && !Array.isArray(val)) deepCache(val, depth + 1);
  }
}

function extractUUID(data) {
  if (!data || typeof data !== "object") return;
  const tryUUID = v => v && typeof v === "string" && UUID_RE.test(v) && fetchQuizByUUID(v);
  tryUUID(data.kahootId); tryUUID(data.quizId); tryUUID(data.uuid); tryUUID(data.id);
  for (const val of Object.values(data)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      tryUUID(val.kahootId); tryUUID(val.quizId); tryUUID(val.uuid);
    }
  }
}

async function fetchQuizByUUID(uuid) {
  if (fetchedUUIDs.has(uuid)) return;
  fetchedUUIDs.add(uuid);
  const endpoints = [
    `https://play.kahoot.it/rest/kahoots/${uuid}?includeKahoot=true`,
    `https://kahoot.it/rest/kahoots/${uuid}?includeKahoot=true`,
    `https://play.kahoot.it/rest/kahoots/${uuid}`,
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) continue;
      const data = await r.json();
      deepCache(data, 0);
      gotNet = true;
      break;
    } catch(e) {}
  }
}

// ── Overlay ───────────────────────────────────────────────────────────────

function ensureOverlay() {
  if (!document.body) return;
  if (ov && document.body.contains(ov)) return;
  if (!document.getElementById("ko-css")) {
    const s = document.createElement("style");
    s.id = "ko-css";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  ov = document.createElement("div");
  ov.id = "ko-overlay";
  document.body.appendChild(ov);
  if (!hid) ov.classList.add("ko-visible");
}

function showAnswer(type, correctChoices, correctTexts, answers) {
  ensureOverlay();
  if (!ov) return;
  let html = `<span class="ko-lbl">✅ KAHOOT HELPER</span>`;
  html += `<span class="ko-type">${esc((type || "quiz").toUpperCase())}</span>`;

  if (type === "jumble" || type === "ordering") {
    if (correctChoices && correctChoices.length) {
      const cardTexts = getJumbleTexts();
      html += `<ul class="ko-choices">`;
      correctChoices.forEach((cardIdx, pos) => {
        const text = (cardTexts && cardTexts[cardIdx]) || (answers && answers[cardIdx]) || ("Tarjeta " + cardIdx);
        html += `<li class="ko-choice ko-ok"><span>${pos + 1}.</span><span>${esc(text)}</span></li>`;
      });
      html += `</ul>`;
    }
  } else {
    if (correctTexts && correctTexts.length) {
      html += `<span class="ko-answer">📝 ${esc(correctTexts.join(" / "))}</span>`;
    }
    if (correctChoices && correctChoices.length) {
      const total = answers ? answers.length : correctChoices[correctChoices.length - 1] + 1;
      html += `<ul class="ko-choices">`;
      for (let i = 0; i < total; i++) {
        const isOk = correctChoices.includes(i);
        const text = answers ? (answers[i] || "") : ("Opción " + (i + 1));
        html += `<li class="ko-choice ${isOk ? "ko-ok" : "ko-no"}">`;
        html += `<span>${LTR[i] || (i + 1)}${isOk ? " ✓" : ""}</span>`;
        html += `<span>${esc(text)}</span></li>`;
      }
      html += `</ul>`;
      highlightButtons(correctChoices);
    }
  }

  ov.innerHTML = html;
  if (!hid) ov.classList.add("ko-visible");
}

function showWaiting(question, alts) {
  ensureOverlay();
  if (!ov) return;
  let html = `<span class="ko-lbl">⏳ ESPERANDO REVEAL…</span>`;
  if (question) {
    html += `<span class="ko-type" style="color:#88aaff!important">${esc(question.slice(0, 100))}</span>`;
  }
  html += `<ul class="ko-choices">`;
  alts.forEach((a, i) => {
    html += `<li class="ko-choice ko-pending"><span>${LTR[i] || (i + 1)}</span><span>${esc(a)}</span></li>`;
  });
  html += `</ul>`;
  ov.innerHTML = html;
  if (!hid) ov.classList.add("ko-visible");
}

function hideOverlay() {
  if (ov) ov.classList.remove("ko-visible");
}

function toggleHide() {
  if (!ov) return;
  hid = !hid;
  if (hid) ov.classList.remove("ko-visible");
  else     ov.classList.add("ko-visible");
}

// ── DOM Helpers ───────────────────────────────────────────────────────────

function getAnswerTexts() {
  const result = [];
  for (let i = 0; i < 6; i++) {
    const el = document.querySelector(`[data-functional-selector="answer-${i}"]`);
    result.push(el ? el.textContent.trim() : null);
  }
  return result;
}

function getJumbleTexts() {
  const texts = [];
  for (let i = 0; i < 10; i++) {
    const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
    if (!el) break;
    texts.push(el.textContent.trim());
  }
  return texts;
}

function highlightButtons(indices) {
  document.querySelectorAll('[data-functional-selector^="answer-"]').forEach(btn => {
    btn.style.outline = "";
    btn.style.boxShadow = "";
  });
  indices.forEach(i => {
    const btn = document.querySelector(`[data-functional-selector="answer-${i}"]`);
    if (btn) {
      btn.style.outline = "4px solid #00ff88";
      btn.style.boxShadow = "0 0 20px #00ff88";
    }
  });
}

// ── Auto-answer (v2 — todos los tipos) ───────────────────────────────────

function simulateDragDrop(source, target) {
  try {
    const sR = source.getBoundingClientRect(), tR = target.getBoundingClientRect();
    const sx = sR.left + sR.width / 2, sy = sR.top + sR.height / 2;
    const tx = tR.left + tR.width / 2, ty = tR.top + tR.height / 2;
    const dt = new DataTransfer();
    source.dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, cancelable:true, clientX:sx, clientY:sy, pointerId:1, isPrimary:true }));
    source.dispatchEvent(new MouseEvent("mousedown",     { bubbles:true, cancelable:true, clientX:sx, clientY:sy, buttons:1 }));
    source.dispatchEvent(new DragEvent("dragstart",      { bubbles:true, cancelable:true, dataTransfer:dt, clientX:sx, clientY:sy }));
    target.dispatchEvent(new DragEvent("dragenter",      { bubbles:true, cancelable:true, dataTransfer:dt, clientX:tx, clientY:ty }));
    target.dispatchEvent(new DragEvent("dragover",       { bubbles:true, cancelable:true, dataTransfer:dt, clientX:tx, clientY:ty }));
    target.dispatchEvent(new DragEvent("drop",           { bubbles:true, cancelable:true, dataTransfer:dt, clientX:tx, clientY:ty }));
    target.dispatchEvent(new PointerEvent("pointerup",   { bubbles:true, cancelable:true, clientX:tx, clientY:ty, pointerId:1, isPrimary:true }));
    source.dispatchEvent(new DragEvent("dragend",        { bubbles:true, cancelable:true, dataTransfer:dt }));
  } catch(e) {}
}

function autoAnswer(type, correctChoices, correctTexts) {
  if (!AUTO_CLICK) return;

  if (type === "quiz") {
    const idx = correctChoices && correctChoices[0];
    if (idx !== undefined && idx !== null) {
      const btn = document.querySelector(`[data-functional-selector="answer-${idx}"]`);
      if (btn && !btn.disabled) setTimeout(() => btn.click(), 400);
    } else if (correctTexts && correctTexts.length) {
      for (let i = 0; i < 6; i++) {
        const btn = document.querySelector(`[data-functional-selector="answer-${i}"]`);
        if (btn && btn.textContent.trim().toLowerCase() === correctTexts[0].toLowerCase()) {
          setTimeout(() => btn.click(), 400);
          break;
        }
      }
    }

  } else if (type === "multiple_select_quiz") {
    if (correctChoices) {
      correctChoices.forEach((idx, n) => {
        setTimeout(() => {
          const btn = document.querySelector(`[data-functional-selector="answer-${idx}"]`);
          if (btn && !btn.disabled) btn.click();
        }, 400 + n * 250);
      });
      setTimeout(() => {
        const sub = document.querySelector('[data-functional-selector="multi-select-submit-button"]');
        if (sub && !sub.disabled) sub.click();
      }, 400 + correctChoices.length * 250 + 400);
    }

  } else if (type === "jumble" || type === "ordering") {
    if (!correctChoices) return;
    const slotSelectors = [
      '[data-functional-selector^="jumble-slot"]',
      '[data-functional-selector^="arranger-slot"]',
      '[class*="JumbleSlot"]',
      '[class*="arranger__Slot"]',
      '[class*="DropZone"]',
    ];
    let slots = null;
    for (const sel of slotSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length >= correctChoices.length) { slots = found; break; }
    }
    correctChoices.forEach((cardIdx, pos) => {
      setTimeout(() => {
        const card = document.querySelector(`[data-functional-selector="draggable-jumble-card-${cardIdx}"]`);
        const slot = slots ? slots[pos] : null;
        if (card && slot) simulateDragDrop(card, slot);
      }, 600 + pos * 700);
    });
    setTimeout(() => {
      for (const sel of [
        '[data-functional-selector="jumble-submit-button"]',
        '[data-functional-selector="submit-button"]',
        'button[type="submit"]',
      ]) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled) { btn.click(); break; }
      }
    }, 600 + correctChoices.length * 700 + 500);

  } else if (type === "open_ended") {
    setTimeout(() => {
      const inp = document.querySelector(
        '[data-functional-selector="open-ended-input"] input, ' +
        '[data-functional-selector="open-ended-input"], ' +
        'input[placeholder], textarea'
      );
      if (inp && correctTexts && correctTexts[0]) {
        try {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(inp, correctTexts[0]);
        } catch(e) { inp.value = correctTexts[0]; }
        inp.dispatchEvent(new Event("input",  { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(() => {
          const sub = document.querySelector('button[type="submit"], [data-functional-selector="submit-button"]');
          if (sub && !sub.disabled) sub.click();
        }, 500);
      }
    }, 500);
  }
}

// ── Show from cache (v2) ──────────────────────────────────────────────────

function showFromCache(qIdx_) {
  if (answerShownForQ === qIdx_) return;
  const c = cachedAnswers[qIdx_];
  if (!c) return;
  answerShownForQ = qIdx_;
  lastProcessedQ  = qIdx_;
  showAnswer(c.type, c.correctChoices, c.correctTexts, c.answers);
  autoAnswer(c.type, c.correctChoices, c.correctTexts);
}

// ── Result payload handler ────────────────────────────────────────────────

function handleResultPayload(data) {
  const qNum = data.questionIndex ?? data.questionNumber ?? data.gameBlockIndex ?? lastProcessedQ;
  const gbs  = data.gameBlockState || data;
  const result = gbs.result || gbs;
  const type   = gbs.gameBlockType || data.type || "quiz";
  const correctChoices = result.correctChoices && result.correctChoices.length ? result.correctChoices : null;
  const correctTexts   = result.correctTexts   && result.correctTexts.length   ? result.correctTexts   : null;
  if (!correctChoices && !correctTexts) return;
  if (answerShownForQ === qNum) return;
  answerShownForQ = qNum;
  lastProcessedQ  = qNum;
  showAnswer(type, correctChoices, correctTexts, getAnswerTexts());
  autoAnswer(type, correctChoices, correctTexts);
}

// ── Network message processing (v1 CometD + v2 pre-cache) ────────────────

function processMsg(d) {
  if (!d || typeof d !== "object") return;

  // Pre-carga por UUID y caché de preguntas REST
  extractUUID(d);
  deepCache(d, 0);

  // Capa CometD: desempaquetar envelope
  if (d.data && typeof d.data === "object") { processMsg(d.data); return; }
  if (typeof d.content === "string") {
    const inner = tryJson(d.content);
    if (inner) { processMsg(inner); return; }
  }

  // Pregunta en vivo por índice
  const qIdxLive = d.gameBlockIndex ?? d.questionIndex;
  if (typeof qIdxLive === "number") {
    // Si tenemos respuesta pre-cargada, mostrar de inmediato
    if (cachedAnswers[qIdxLive] && answerShownForQ !== qIdxLive) {
      showFromCache(qIdxLive);
      return;
    }
    // Si el mensaje trae choices con correctness
    if (d.choices && Array.isArray(d.choices)) {
      cacheQuestion(d, qIdxLive);
      if (cachedAnswers[qIdxLive]) { showFromCache(qIdxLive); return; }
    }
  }

  // CometD Fase 1: alternatives sin correctAnswers → esperar reveal
  if (Array.isArray(d.alternatives) && d.alternatives.length >= 2 && !d.correctAnswers) {
    const qi = d.questionIndex != null ? d.questionIndex : 0;
    // Si ya tenemos caché para esta pregunta, mostrar directamente
    if (cachedAnswers[qi] && answerShownForQ !== qi) { showFromCache(qi); return; }
    const qtext = d.question || d.questionStem || d.title || "";
    const alts  = d.alternatives.map(a => typeof a === "string" ? a : String(a.answer || a.text || a.value || ""));
    _pendAlt[qi] = { question: qtext, alts };
    showWaiting(qtext, alts);
    return;
  }

  // CometD Fase 2: correctAnswers reveal
  if (Array.isArray(d.correctAnswers)) {
    const qi2    = d.questionIndex != null ? d.questionIndex : 0;
    const pending = _pendAlt[qi2];
    if (pending && pending.alts.length >= 2) {
      const correctSet = new Set(d.correctAnswers);
      const q = {
        question: pending.question,
        type: d.type || "quiz",
        choices: pending.alts.map((a, i) => ({ text: a, correct: correctSet.has(i) }))
      };
      storeQ([q], "cometd");
      delete _pendAlt[qi2];
      return;
    }
    if (Array.isArray(d.alternatives) && d.alternatives.length >= 2) {
      const correctSet2 = new Set(d.correctAnswers);
      storeQ([{
        question: d.question || d.questionStem || "",
        type: d.type || "quiz",
        choices: d.alternatives.map((a, i) => ({
          text: typeof a === "string" ? a : String(a.answer || a.text || ""),
          correct: correctSet2.has(i)
        }))
      }], "cometd-inline");
      return;
    }
  }

  // Payload con resultado (correctChoices/correctTexts)
  const str = JSON.stringify(d);
  if (str.includes("correctChoices") || str.includes("correctTexts")) {
    handleResultPayload(d);
  }

  // Extracción genérica como fallback
  const qs = exAll(d);
  if (qs.length) storeQ(qs, "generic");
}

// ── Storage ───────────────────────────────────────────────────────────────

function makeSig(q) {
  return normA(q.question || "").slice(0, 60) + "\x00" +
    q.choices.map(c => norm(c.text)).sort().join("|");
}

function storeQ(qs, src) {
  const before = qList.length;
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (!Array.isArray(q.choices) || q.choices.length < 2) continue;
    const sig = makeSig(q);
    if (!sig.replace(/[\x00|]/g, "").trim()) continue;
    if (!qList.some(x => makeSig(x) === sig)) qList.push(q);
  }
  if (qList.length > before) gotNet = true;

  if (src === "cometd" || src === "cometd-inline") {
    let target = null;
    if (qList.length > before) {
      target = qList[qList.length - 1];
    } else if (qs.length) {
      const s0 = makeSig(qs[0]);
      for (let k = qList.length - 1; k >= 0; k--) {
        if (makeSig(qList[k]) === s0) { target = qList[k]; break; }
      }
    }
    if (target) {
      cur  = target;
      qIdx = qList.indexOf(target);
      showAnswerFromQ(target);
    }
  } else if (qList.length > before) {
    const found = findMatch();
    if (found && found !== cur) {
      cur  = found;
      qIdx = qList.indexOf(found);
      showAnswerFromQ(found);
    }
  }
}

function showAnswerFromQ(q) {
  if (!q) return;
  const correctChoices = q.choices.map((c, i) => c.correct ? i : -1).filter(i => i >= 0);
  const correctTexts   = q.choices.filter(c => c.correct).map(c => c.text);
  const answers        = q.choices.map(c => c.text);
  const type           = q.type || "quiz";
  showAnswer(type, correctChoices, correctTexts, answers);
  autoAnswer(type, correctChoices, correctTexts);
}

// ── DOM Matching (v1) ─────────────────────────────────────────────────────

function isVisible(el) {
  if (!el) return false;
  try { const cs = getComputedStyle(el); return cs.display!=="none"&&cs.visibility!=="hidden"&&parseFloat(cs.opacity)>0.01; } catch(e) { return false; }
}

function textAt(x, y, minLen, maxLen) {
  minLen = minLen == null ? 2 : minLen;
  maxLen = maxLen == null ? 400 : maxLen;
  try {
    let el = document.elementFromPoint(x, y);
    if (!el || el === document.documentElement || el === document.body) return "";
    if (ov && ov.contains(el)) return "";
    for (let d = 0; d < 8 && el && el !== document.body; d++) {
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (t.length >= minLen && t.length <= maxLen) return t;
      el = el.parentElement;
    }
    return "";
  } catch(e) { return ""; }
}

function getScreenQuestion() {
  const W = window.innerWidth, H = window.innerHeight;
  const pts = [
    [W*.50,H*.22],[W*.50,H*.28],[W*.40,H*.30],[W*.60,H*.30],
    [W*.50,H*.38],[W*.50,H*.50],[W*.50,H*.57],
    [W*.40,H*.60],[W*.50,H*.63],[W*.60,H*.60],
  ];
  let best = "";
  for (let i = 0; i < pts.length; i++) {
    const t = textAt(pts[i][0], pts[i][1], 10, 400);
    if (t.length > best.length) best = t;
  }
  return best;
}

function getScreenChoices() {
  const W = window.innerWidth, H = window.innerHeight;
  return [
    textAt(W*.25,H*.70,1,150), textAt(W*.75,H*.70,1,150),
    textAt(W*.25,H*.80,1,150), textAt(W*.75,H*.80,1,150),
    textAt(W*.25,H*.88,1,150), textAt(W*.75,H*.88,1,150),
  ];
}

function findMatch() {
  if (!qList.length || !document.body) return null;
  const screenQ = normA(getScreenQuestion());
  const screenC = getScreenChoices().map(t => normA(t));
  const validC  = screenC.filter(t => t.length > 2);
  const useCoords = screenQ.length >= 5 || validC.length >= 2;
  const ifrTxt    = (_iframeBodyText && _iframeBodyText.length > 10) ? _iframeBodyText : "";
  let bodyTxt = "";
  if (!useCoords && !ifrTxt) {
    try { bodyTxt = normA((document.body.innerText || "").slice(0, 3000)); } catch(e) {}
  }
  const searchTxt = ifrTxt || bodyTxt;
  if (!useCoords && searchTxt.length < 10) return null;

  let best = null, bestScore = 0;
  for (let i = 0; i < qList.length; i++) {
    const q = qList[i];
    let score = 0;
    if (useCoords) {
      if (q.question && screenQ.length >= 5) {
        const qn = normA(q.question).slice(0, 80);
        if (qn.length >= 5 && (screenQ.indexOf(qn) !== -1 || qn.indexOf(screenQ.slice(0, 70)) !== -1)) score += 6;
      }
      for (let j = 0; j < q.choices.length; j++) {
        const cn = normA(q.choices[j].text).slice(0, 50);
        if (cn.length < 3) continue;
        for (let k = 0; k < screenC.length; k++) {
          if (screenC[k].length >= 3 && screenC[k].indexOf(cn) !== -1) { score += 3; break; }
        }
      }
    } else {
      if (q.question) {
        const qn2 = normA(q.question).slice(0, 80);
        if (qn2.length >= 5 && searchTxt.indexOf(qn2) !== -1) score += 4;
      }
      for (let j2 = 0; j2 < q.choices.length; j2++) {
        const cn2 = normA(q.choices[j2].text).slice(0, 50);
        if (cn2.length >= 3 && searchTxt.indexOf(cn2) !== -1) score += 2;
      }
    }
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return bestScore >= 4 ? best : null;
}

// ── Scan DOM ──────────────────────────────────────────────────────────────

function scanDOM() {
  if (!ov || !document.contains(ov)) { ensureOverlay(); return; }
  if (!qList.length) return;
  const now = Date.now();
  if (now - _scanThrottle < 250) return;
  _scanThrottle = now;

  function pageHash() {
    const sq = normA(getScreenQuestion());
    if (sq.length > 5) return sq.slice(0, 80);
    if (_iframeBodyText && _iframeBodyText.length > 10) return _iframeBodyText.slice(0, 80);
    try { return normA((document.body.innerText || "").slice(0, 300)).slice(0, 80); } catch(e) { return ""; }
  }

  const found = findMatch();
  if (found && found !== cur) {
    cur  = found;
    qIdx = qList.indexOf(found);
    showAnswerFromQ(found);
    _pageHash = pageHash();
    return;
  }

  if (!cur && qList.length > 0) {
    qIdx = 0; cur = qList[0];
    showAnswerFromQ(cur);
    _pageHash = pageHash();
    return;
  }

  const hash = pageHash();
  if (hash !== _pageHash && hash.length > 10 && now - _seqLastAdvance > 1500) {
    _pageHash = hash;
    _seqLastAdvance = now;
    const next = (qIdx + 1) % qList.length;
    qIdx = next;
    cur  = qList[qIdx];
    showAnswerFromQ(cur);
  }
}

function startObs() {
  if (obs) obs.disconnect();
  obs = new MutationObserver(() => { clearTimeout(dbt); dbt = setTimeout(scanDOM, 150); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

function scanInlineData() {
  const nd = document.getElementById("__NEXT_DATA__");
  if (nd) {
    const qs = exAll(tryJson(nd.textContent) || {});
    if (qs.length) { storeQ(qs, "inline:next"); return; }
  }
  const scripts = document.querySelectorAll('script[type="application/json"]');
  for (const s of scripts) {
    const qs2 = exAll(tryJson(s.textContent) || {});
    if (qs2.length) storeQ(qs2, "inline:script");
  }
}

// ── localStorage polling (v2) ─────────────────────────────────────────────

function pollLocalStorage() {
  try {
    const raw = localStorage.getItem("kahoot-game_session");
    if (!raw) return;
    const d = JSON.parse(raw);
    deepCache(d, 0);
    extractUUID(d);
    const qNum = d.questionNumber ?? d.gameBlockIndex;
    const gbs  = d.gameBlockState;
    if (!gbs) return;
    const result = gbs.result || {};
    const correctChoices = result.correctChoices && result.correctChoices.length ? result.correctChoices : null;
    const correctTexts   = result.correctTexts   && result.correctTexts.length   ? result.correctTexts   : null;
    if (answerShownForQ === qNum || (!correctChoices && !correctTexts)) return;
    answerShownForQ = qNum;
    lastProcessedQ  = qNum;
    showAnswer(gbs.gameBlockType || "quiz", correctChoices, correctTexts, getAnswerTexts());
    autoAnswer(gbs.gameBlockType || "quiz", correctChoices, correctTexts);
  } catch(e) {}
}

// ── URL observer (v2) ─────────────────────────────────────────────────────

let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url === lastUrl) return;
  lastUrl = url;
  const inGame = url.includes("gameblock") || url.includes("answer") || url.includes("play.kahoot");
  if (!inGame) {
    hideOverlay();
    lastProcessedQ  = -1;
    answerShownForQ = -1;
  } else {
    setTimeout(pollLocalStorage, 300);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// ── Event Listeners ───────────────────────────────────────────────────────

// Datos de red desde background.js (MAIN world hooks → ISOLATED world)
window.addEventListener("__ko__", function(e) {
  try {
    if (!e.detail) return;
    const raw = typeof e.detail === "string" ? tryJson(e.detail) : e.detail;
    if (!raw) return;
    if (Array.isArray(raw)) raw.forEach(item => processMsg(item));
    else processMsg(raw);
  } catch(err) {}
});

// Alt+H para mostrar/ocultar
window.addEventListener("keydown", function(e) {
  if (window !== window.top) return;
  const isHide = e.altKey && (e.code === "KeyH" || e.key === "h" || e.key === "H");
  if (!isHide) return;
  e.stopImmediatePropagation(); e.preventDefault();
  toggleHide();
}, true);

// ── Inicialización ────────────────────────────────────────────────────────

window.addEventListener("load", function koInit() {

  // IFRAME: reenviar datos al top frame (donde vive el overlay)
  if (window !== window.top) {
    let _ifDbt = null;
    function relayText() {
      try {
        const t = normA((document.body.innerText || "").slice(0, 1200));
        if (t.length > 10) window.top.postMessage({ __ko_txt: t }, "*");
      } catch(e) {}
    }
    window.addEventListener("__ko__", function(e) {
      try { window.top.postMessage({ __ko_evt: e.detail }, "*"); } catch(_) {}
    });
    window.addEventListener("keydown", function(e) {
      const isHide = e.altKey && (e.code === "KeyH" || e.key === "h" || e.key === "H");
      if (!isHide) return;
      e.stopImmediatePropagation(); e.preventDefault();
      try { window.top.postMessage({ __ko_key: "toggleHide" }, "*"); } catch(_) {}
    }, true);
    new MutationObserver(() => { clearTimeout(_ifDbt); _ifDbt = setTimeout(relayText, 180); })
      .observe(document.documentElement, { childList: true, subtree: true });
    relayText();
    return;
  }

  // TOP FRAME: recibir relays del iframe hijo
  window.addEventListener("message", function(e) {
    if (!e.data) return;
    if (typeof e.data.__ko_txt === "string" && e.data.__ko_txt.length > 10) {
      _iframeBodyText = e.data.__ko_txt;
      clearTimeout(_iframeTextDbt);
      _iframeTextDbt = setTimeout(scanDOM, 180);
    }
    if (e.data.__ko_evt) {
      try {
        const raw = tryJson(e.data.__ko_evt);
        if (!raw) return;
        if (Array.isArray(raw)) raw.forEach(item => processMsg(item));
        else processMsg(raw);
      } catch(_) {}
    }
    if (e.data.__ko_key === "toggleHide") toggleHide();
  });

  ensureOverlay();
  startObs();
  scanDOM();
  scanInlineData();

  try { chrome.runtime.sendMessage({ type: "ko_inject" }); } catch(e) {}

  setInterval(() => {
    if (!ov || !document.contains(ov)) ensureOverlay();
    scanDOM();
    pollLocalStorage();
  }, 800);

  let _koLastHref = location.href;
  setInterval(() => {
    if (location.href === _koLastHref) return;
    _koLastHref = location.href;
    try { chrome.runtime.sendMessage({ type: "ko_inject" }); } catch(e) {}
    setTimeout(scanInlineData, 700);
  }, 600);

  setInterval(pollLocalStorage, 300);

}, false);
