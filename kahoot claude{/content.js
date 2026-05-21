(function () {
  const AUTO_CLICK = true;

  // Capturar originales primero, antes de que cualquier otra cosa los reemplace
  const _origFetch     = window.fetch;
  const _origWebSocket = window.WebSocket;
  const _origXhrOpen   = XMLHttpRequest.prototype.open;
  const _origXhrSend   = XMLHttpRequest.prototype.send;
  const _origSetItem   = Storage.prototype.setItem;

  let lastProcessedQ = -1;
  let overlay        = null;
  let answerShownForQ = -1;
  const cachedAnswers  = {}; // gameBlockIndex → { type, correctChoices, answers, correctTexts }
  const fetchedUUIDs   = new Set();

  // ── Overlay ──────────────────────────────────────────────────────────────

  function ensureOverlay() {
    if (overlay && document.body.contains(overlay)) return;
    overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; top:12px; right:12px; z-index:2147483647;
      background:rgba(0,0,0,0.9); color:#00ff88;
      font:bold 16px Arial,sans-serif; padding:12px 18px;
      border-radius:10px; border:2px solid #00ff88;
      box-shadow:0 0 25px rgba(0,255,136,0.6);
      max-width:320px; pointer-events:none; display:none;
    `;
    document.body.appendChild(overlay);
  }

  function showAnswer(type, correctChoices, correctTexts, answers) {
    ensureOverlay();
    let html = `<div style="font-size:11px;color:#aaa;margin-bottom:6px">✅ KAHOOT HELPER</div>`;
    html += `<div style="font-size:12px;color:#ffdd00;margin-bottom:4px">${(type || '?').toUpperCase()}</div>`;

    if (type === 'jumble' || type === 'ordering') {
      const cardTexts = getJumbleTexts();
      if (correctChoices && correctChoices.length) {
        html += `<div style="margin-top:4px;font-size:13px;line-height:1.7">`;
        correctChoices.forEach((cardIdx, pos) => {
          const text = (cardTexts && cardTexts[cardIdx]) || (answers && answers[cardIdx]) || 'Tarjeta ' + cardIdx;
          html += `<div>${pos + 1}. ${text}</div>`;
        });
        html += `</div>`;
      }
    } else {
      if (correctTexts && correctTexts.length) {
        html += `<div>📝 ${correctTexts.join(' / ')}</div>`;
      }
      if (correctChoices && correctChoices.length && answers) {
        const names = correctChoices.map(i => answers[i] || `Opción ${i}`);
        html += `<div>✔️ ${names.join(' + ')}</div>`;
        highlightButtons(correctChoices);
      }
    }

    overlay.innerHTML = html;
    overlay.style.display = 'block';
  }

  function hideAnswer() {
    if (overlay) overlay.style.display = 'none';
  }

  function highlightButtons(indices) {
    document.querySelectorAll('[data-functional-selector^="answer-"]').forEach(btn => {
      btn.style.outline = '';
      btn.style.boxShadow = '';
    });
    indices.forEach(i => {
      const btn = document.querySelector(`[data-functional-selector="answer-${i}"]`);
      if (btn) {
        btn.style.outline = '4px solid #00ff88';
        btn.style.boxShadow = '0 0 20px #00ff88';
      }
    });
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

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

  // ── Quiz pre-load: PIN → UUID → respuestas completas ─────────────────────

  async function fetchQuizByUUID(uuid) {
    if (fetchedUUIDs.has(uuid)) return;
    fetchedUUIDs.add(uuid);
    // Kahoot devuelve el quiz completo con respuestas correctas en estas URLs
    const endpoints = [
      `https://play.kahoot.it/rest/kahoots/${uuid}?includeKahoot=true`,
      `https://kahoot.it/rest/kahoots/${uuid}?includeKahoot=true`,
      `https://play.kahoot.it/rest/kahoots/${uuid}`,
    ];
    for (const url of endpoints) {
      try {
        const r = await _origFetch(url, { credentials: 'include' });
        if (!r.ok) continue;
        const data = await r.json();
        deepCache(data, 0);
        break;
      } catch (e) {}
    }
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function extractUUID(data) {
    if (!data || typeof data !== 'object') return;
    // La respuesta de /reserve/session/{PIN} contiene kahootId
    const tryUUID = v => v && typeof v === 'string' && UUID_RE.test(v) && fetchQuizByUUID(v);
    tryUUID(data.kahootId);
    tryUUID(data.quizId);
    tryUUID(data.uuid);
    tryUUID(data.id);
    // Un nivel más adentro
    for (const val of Object.values(data)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        tryUUID(val.kahootId);
        tryUUID(val.quizId);
        tryUUID(val.uuid);
      }
    }
  }

  // ── Answer cache ──────────────────────────────────────────────────────────

  function cacheQuestion(q, idx) {
    if (cachedAnswers[idx]) return;
    const type    = q.type || q.gameBlockType || 'quiz';
    const choices = q.choices || q.answerChoices || [];
    if (!choices.length) return;

    if (type === 'jumble' || type === 'ordering') {
      // choices[i].correct = posición destino de la tarjeta i
      const order = new Array(choices.length);
      let valid = false;
      choices.forEach((c, i) => {
        const pos = typeof c.correct === 'number' ? c.correct : parseInt(c.correct);
        if (!isNaN(pos)) { order[pos] = i; valid = true; }
      });
      if (valid) {
        cachedAnswers[idx] = {
          type,
          correctChoices: order,
          answers: choices.map(c => c.answer || c.text || ''),
        };
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
          answers: choices.map(c => c.answer || c.text || ''),
          correctTexts: q.correctAnswers || null,
        };
      }
    }
  }

  function deepCache(data, depth) {
    if (!data || typeof data !== 'object' || depth > 7) return;
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q, i) => cacheQuestion(q, i));
    }
    if (data.kahoot) deepCache(data.kahoot, depth + 1);
    // Pregunta individual con gameBlockIndex
    if (data.choices && Array.isArray(data.choices)) {
      const idx = data.gameBlockIndex ?? data.questionIndex;
      if (typeof idx === 'number') cacheQuestion(data, idx);
    }
    for (const val of Object.values(data)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) deepCache(val, depth + 1);
    }
  }

  function showFromCache(qIdx) {
    if (answerShownForQ === qIdx) return;
    const c = cachedAnswers[qIdx];
    if (!c) return;
    answerShownForQ = qIdx;
    lastProcessedQ  = qIdx;
    showAnswer(c.type, c.correctChoices, c.correctTexts, c.answers);
    autoAnswer(c.type, c.correctChoices, c.correctTexts);
  }

  // ── Auto-answer ───────────────────────────────────────────────────────────

  function simulateDragDrop(source, target) {
    try {
      const sR = source.getBoundingClientRect(), tR = target.getBoundingClientRect();
      const sx = sR.left + sR.width / 2, sy = sR.top + sR.height / 2;
      const tx = tR.left + tR.width / 2, ty = tR.top + tR.height / 2;
      const dt = new DataTransfer();
      source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, pointerId: 1, isPrimary: true }));
      source.dispatchEvent(new MouseEvent('mousedown',     { bubbles: true, cancelable: true, clientX: sx, clientY: sy, buttons: 1 }));
      source.dispatchEvent(new DragEvent('dragstart',      { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sx, clientY: sy }));
      target.dispatchEvent(new DragEvent('dragenter',      { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
      target.dispatchEvent(new DragEvent('dragover',       { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
      target.dispatchEvent(new DragEvent('drop',           { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
      target.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true, clientX: tx, clientY: ty, pointerId: 1, isPrimary: true }));
      source.dispatchEvent(new DragEvent('dragend',        { bubbles: true, cancelable: true, dataTransfer: dt }));
    } catch (e) {}
  }

  function autoAnswer(type, correctChoices, correctTexts) {
    if (!AUTO_CLICK) return;

    if (type === 'quiz') {
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

    } else if (type === 'multiple_select_quiz') {
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

    } else if (type === 'jumble' || type === 'ordering') {
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

    } else if (type === 'open_ended') {
      setTimeout(() => {
        const inp = document.querySelector(
          '[data-functional-selector="open-ended-input"] input, ' +
          '[data-functional-selector="open-ended-input"], ' +
          'input[placeholder], textarea'
        );
        if (inp && correctTexts && correctTexts[0]) {
          try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(inp, correctTexts[0]);
          } catch (e) { inp.value = correctTexts[0]; }
          inp.dispatchEvent(new Event('input',  { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          setTimeout(() => {
            const sub = document.querySelector('button[type="submit"], [data-functional-selector="submit-button"]');
            if (sub && !sub.disabled) sub.click();
          }, 500);
        }
      }, 500);
    }
  }

  // ── Network interceptors ──────────────────────────────────────────────────

  function handleAllData(data) {
    if (!data || typeof data !== 'object') return;
    extractUUID(data);   // intenta pre-cargar el quiz completo por UUID
    deepCache(data, 0);  // cachea preguntas y respuestas encontradas
    handleGameMessage(data);
  }

  function handleGameMessage(d) {
    const qIdx = d.gameBlockIndex ?? d.questionIndex;
    if (typeof qIdx === 'number') {
      // Si ya tenemos el quiz cacheado, mostramos de inmediato
      if (cachedAnswers[qIdx] && answerShownForQ !== qIdx) {
        showFromCache(qIdx);
        return;
      }
      // Si esta pregunta trae sus propios choices con correct markers
      if (d.choices && Array.isArray(d.choices)) {
        cacheQuestion(d, qIdx);
        showFromCache(qIdx);
      }
    }
    // Fase resultado: correctChoices / correctTexts
    const str = JSON.stringify(d);
    if (str.includes('correctChoices') || str.includes('correctTexts')) {
      handleResultPayload(d);
    }
  }

  function handleResultPayload(data) {
    const qNum = data.questionIndex ?? data.questionNumber ?? data.gameBlockIndex ?? lastProcessedQ;
    const gbs  = data.gameBlockState || data;
    const result = gbs.result || gbs;
    const type   = gbs.gameBlockType || data.type || '';
    const correctChoices = result.correctChoices && result.correctChoices.length ? result.correctChoices : null;
    const correctTexts   = result.correctTexts   && result.correctTexts.length   ? result.correctTexts   : null;
    if (!correctChoices && !correctTexts) return;
    if (answerShownForQ === qNum) return;
    answerShownForQ = qNum;
    lastProcessedQ  = qNum;
    showAnswer(type, correctChoices, correctTexts, getAnswerTexts());
    autoAnswer(type, correctChoices, correctTexts);
  }

  // WebSocket
  window.WebSocket = function (...args) {
    const ws = new _origWebSocket(...args);
    ws.addEventListener('message', function (event) {
      try {
        const msgs = JSON.parse(event.data);
        const arr  = Array.isArray(msgs) ? msgs : [msgs];
        arr.forEach(msg => {
          let payload = msg.data;
          if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (e) {} }
          let content = payload && payload.content;
          if (typeof content === 'string') { try { content = JSON.parse(content); } catch (e) {} }
          [payload, content].forEach(d => { if (d && typeof d === 'object') handleAllData(d); });
        });
      } catch (e) {}
    });
    return ws;
  };
  window.WebSocket.prototype = _origWebSocket.prototype;

  // Fetch (captura TODAS las respuestas — incluyendo /reserve/session/{PIN})
  window.fetch = async function (...args) {
    const res = await _origFetch.apply(this, args);
    try {
      res.clone().json().then(handleAllData).catch(() => {});
    } catch (e) {}
    return res;
  };

  // XHR
  XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    return _origXhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try { handleAllData(JSON.parse(this.responseText)); } catch (e) {}
    });
    return _origXhrSend.apply(this, arguments);
  };

  // ── localStorage ──────────────────────────────────────────────────────────

  Storage.prototype.setItem = function (key, value) {
    _origSetItem.apply(this, arguments);
    if (key !== 'kahoot-game_session') return;
    try {
      const d = JSON.parse(value);
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
      showAnswer(gbs.gameBlockType, correctChoices, correctTexts, getAnswerTexts());
      autoAnswer(gbs.gameBlockType, correctChoices, correctTexts);
    } catch (e) {}
  };

  function poll() {
    try {
      const raw = localStorage.getItem('kahoot-game_session');
      if (raw) {
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
        showAnswer(gbs.gameBlockType, correctChoices, correctTexts, getAnswerTexts());
        autoAnswer(gbs.gameBlockType, correctChoices, correctTexts);
      }
    } catch (e) {}
  }

  setInterval(poll, 300);

  // ── URL observer ──────────────────────────────────────────────────────────

  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    const inGame = url.includes('gameblock') || url.includes('answer') || url.includes('play.kahoot');
    if (!inGame) {
      hideAnswer();
      lastProcessedQ  = -1;
      answerShownForQ = -1;
    } else {
      setTimeout(poll, 300);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.body) ensureOverlay();
  else document.addEventListener('DOMContentLoaded', ensureOverlay);

})();
