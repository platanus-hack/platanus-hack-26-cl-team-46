import { svgEl, htmlEl, sleep, animate, rectOf, reducedMotion } from './geometry.js';
import { THEMES } from './theme.js';
import { checkSvg } from './icons.js';
import { createPen } from './pen.js';
import { createMarks } from './marks.js';
import { createCards } from './cards.js';
import { createActions, isSecretField } from './actions.js';
import { createIsland } from './island.js';
import { createVoiceInput, stopSpeaking } from './voice.js';
import { createDirector } from './director.js';
import { createGesture } from './gesture.js';
import { createSounds } from './sounds.js';
import { harvestScreen, labelShot, shownFraction, ATTACK } from './harvest.js';

// Public entry point. Mount once on any page:
//   const clicky = createClicky({ api: 'https://api.example.com/clicky', headers: () => ({ 'x-sim-id': id }) })
// Hinty sees the page like HeyClicky sees the screen: every visible control, heading, row and text
// with its box (harvest.js), numbered on the screenshot (set-of-marks), so it points at the exact
// thing. A page can name things better with data-clicky="short description" and hide them with
// data-clicky-ignore. Free space for charts and cards: data-clicky-region="stage" / "stage-side".
// screenshot: async () => dataURL | null, a capture of what the user sees right now.
// context: string (or () => string) describing the app, sent with every question.
// headers: () => object, extra headers for every request (the backend needs x-sim-id).
// The answer streams in (NDJSON, one beat per line) and plays as it arrives. Beats may carry
// their voice already synthesized (beat.audio); otherwise the browser speaks.
// Talking: hold fn (or the talk button; a short click keeps it listening). Marking: the pencil turns on
// the mark mode, and while it is on, holding Shift draws with the cursor; the marks go with the next
// question (spoken or typed).
// buddy: the blip follows the cursor when Hinty is not drawing. proactive: when a new attacker
// signal shows up, Hinty flies there and offers to explain it (at most once every 45 s).
export function createClicky({
  api = '/clicky', headers: extraHeaders = () => ({}), theme = 'mayday', voice = true, pushToTalkKey = 'Fn', cssHref = '/clicky/styles.css',
  hint, screenshot, context = '', autoTag = true, ignore = '[data-clicky-ignore]', surface = 'light', liveTranscription = true,
  buddy = true, proactive = true, sounds: soundsOn = true, setOfMarks = true, onClose,
} = {}) {
  if (!document.querySelector('link[data-clicky-css]')) {
    const link = htmlEl('link', '', document.head);
    link.rel = 'stylesheet';
    link.href = cssHref;
    link.dataset.clickyCss = '';
  }

  // El destacador va en su propia capa, en modo screen: sobre fondo oscuro, multiply ensucia.
  const multiply = htmlEl('div', 'clicky-root', document.body);
  multiply.style.mixBlendMode = 'screen';
  multiply.style.zIndex = '2147482999';
  const root = htmlEl('div', 'clicky-root', document.body);
  const layers = {
    highlight: svgEl('svg', { class: 'clicky-layer' }, multiply),
    spot: svgEl('svg', { class: 'clicky-layer clicky-spot' }, root),
    marks: svgEl('svg', { class: 'clicky-layer' }, root),
    panels: htmlEl('div', 'clicky-panels', root),
    top: svgEl('svg', { class: 'clicky-layer' }, root),
  };
  layers.spot.style.opacity = 0;
  const gesture = createGesture(root, { words: () => partial.split(/\s+/).filter(Boolean).length });
  const penLayer = svgEl('svg', { class: 'clicky-layer clicky-penlayer' }, root);

  let current = THEMES[theme] || THEMES.mayday, voiceOn = voice, history = [], busy = false, answering = null;
  let talking = false, askGen = 0, lastQuestion = '', lastAnswerAt = 0, partial = '', interruptedSay = '', stepSeen = () => {};
  const alias = new Map(); // e1, e2… → elemento, de la última cosecha
  const ctx = {
    layers, themes: THEMES, theme: () => current,
    strokes: [], items: [], fades: [], spotHoles: [], anchors: [], sideY: 0, board: null, actions: null, surface, walk: null,
    find: id => (id && (alias.get(id) || document.getElementById(id))) || null,
    elements: () => alias.values(),
    onAsk: q => ask(q),
    renderSpotlight() {
      layers.spot.innerHTML = '';
      const holes = ctx.spotHoles.filter(h => h.el.isConnected).map(h => rectOf(h.el, h.pad));
      const m = svgEl('mask', { id: 'clicky-spot-mask' }, svgEl('defs', {}, layers.spot));
      svgEl('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: '#fff' }, m);
      holes.forEach(b => svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, fill: '#000' }, m));
      const dim = (surface === 'dark' && current.onDark?.spotlight) || current.spotlight;
      svgEl('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: dim, mask: 'url(#clicky-spot-mask)' }, layers.spot);
      // el hueco lleva un borde cian de 2 px (radius-md)
      holes.forEach(b => svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, fill: 'none', stroke: current.mark, 'stroke-width': 2 }, layers.spot));
    },
  };
  const sounds = ctx.sound = createSounds(() => soundsOn && voiceOn);
  ctx.pen = createPen(penLayer, { onStroke: t => sounds.stroke(t) });
  const marks = createMarks(ctx), cards = createCards(ctx);
  const actions = createActions(ctx, { onStep: s => waitStep(s) });
  const ACT = { click: actions.click, type: actions.type, scroll: actions.scroll, step: actions.step };
  const draw = (m, s) => (marks[m.type] || ACT[m.type] || cards[m.type])?.(m, s);

  const talkKey = hint || (pushToTalkKey === 'Fn' ? 'fn' : pushToTalkKey === 'Space' ? 'espacio' : pushToTalkKey);
  const island = createIsland(root, { talkKey, onType: q => typed(q), onTalk: t => talkButton(t), onMark: () => toggleMark(), onClose, onClear: () => clearAll(), talkCode: pushToTalkKey });
  const releaseSpotlight = () => {
    if (!ctx.spotHoles.length) return;
    ctx.spotHoles = [];
    animate(0.5, u => layers.spot.style.opacity = 1 - u);
  };
  const director = createDirector({ draw, island, voice: () => voiceOn, onBeat: b => b.marks.some(m => m.type === 'spotlight') || releaseSpotlight() });

  function setTheme(name) {
    current = THEMES[name] || current;
    root.dataset.theme = multiply.dataset.theme = name;
    root.dataset.surface = surface;
    for (const [k, v] of Object.entries({ '--c-ink': current.ink, '--c-mark': current.mark, '--c-hot': current.hot, '--c-hl': current.highlighter, '--c-pen': current.pen, '--c-attack': current.attack }))
      [root, multiply].forEach(r => r.style.setProperty(k, v));
  }
  setTheme(theme);
  island.idle();

  // El blip acompaña al cursor salvo cuando está explicando, esperando un paso o avisando algo.
  let pending = null, nudging = null;
  function syncPen() {
    const free = !talking && !pending && !nudging;
    if (buddy) ctx.pen.follow(free);
    else if (free) ctx.pen.hide();
  }
  const dim = on => [root, multiply].forEach(r => r.classList.toggle('clicky-dimmed', on));

  // Erases the drawing. `fast`: a quick fade instead of running the pen backwards, used when a
  // new question comes in, so the screen is clean for the capture without making anyone wait.
  async function wipe({ fast = false } = {}) {
    director.stop();
    stopSpeaking();
    answering?.abort();
    answering = null;
    ctx.cancelConfirm?.();
    pending = null;
    nudging = null;
    const items = ctx.items.splice(0), strokes = ctx.strokes.splice(0).reverse(), fades = ctx.fades.splice(0), anchors = ctx.anchors.splice(0);
    items.forEach(el => el.classList.add('clicky-out'));
    fades.forEach(el => animate(0.15, u => el.setAttribute('opacity', current.zoneOpacity * (1 - u))));
    if (ctx.spotHoles.length) animate(fast ? 0.15 : 0.3, u => layers.spot.style.opacity = 1 - u);
    if (fast) {
      await Promise.all(strokes.map(({ path }) => animate(0.15, u => path.setAttribute('opacity', 1 - u)).then(() => path.remove())));
      items.forEach(el => (el.style.transition = 'opacity .15s'));
    } else {
      const per = Math.min(0.14, 0.9 / Math.max(1, strokes.length));
      for (const { path, anchor: a } of strokes) await ctx.pen.erase(path, per, a?.dx || 0, a?.dy || 0);
    }
    await sleep(fast ? 160 : 300);
    items.forEach(el => el.remove());
    fades.forEach(el => el.remove());
    anchors.forEach(a => { a.g.remove(); a.gh.remove(); a.div.remove(); });
    ctx.spotHoles = []; ctx.sideY = 0; ctx.board = null; ctx.flow = null; ctx.actions = null;
    layers.spot.innerHTML = ''; layers.spot.style.opacity = 0;
    dim(false);
    syncPen();
  }

  // Las marcas siguen a su elemento: si la página (o un panel) hace scroll, se mueven con él.
  let reflowRaf = 0;
  function reflow() {
    if (reflowRaf || (!ctx.anchors.length && !ctx.spotHoles.length)) return;
    reflowRaf = requestAnimationFrame(() => {
      reflowRaf = 0;
      const cache = new Map();
      for (const a of ctx.anchors) {
        // si el elemento salió de su panel (scroll adentro de un chat o un log), su marca se esconde
        const gone = !a.el.isConnected || shownFraction(a.el, cache) < 0.3;
        [a.g, a.gh].forEach(g => g.style.opacity = gone ? '0' : '');
        a.div.style.opacity = gone ? '0' : '';
        if (gone) continue;
        const r = a.el.getBoundingClientRect();
        a.dx = r.left - a.base.x;
        a.dy = r.top - a.base.y;
        const t = `translate(${a.dx.toFixed(1)} ${a.dy.toFixed(1)})`;
        a.g.setAttribute('transform', t);
        a.gh.setAttribute('transform', t);
        a.div.style.translate = `${a.dx.toFixed(1)}px ${a.dy.toFixed(1)}px`;
      }
      if (ctx.spotHoles.length) ctx.renderSpotlight();
    });
  }
  addEventListener('scroll', reflow, { capture: true, passive: true });
  addEventListener('resize', reflow);

  // Qué hay en pantalla y dónde (alias e1, e2…). Se cosecha una vez por pregunta y la usan el
  // gesto (qué marcó), la captura numerada y las marcas del modelo: todos hablan de lo mismo.
  const skip = e => (ignore && e.closest(ignore)) || (!autoTag && !e.hasAttribute('data-clicky'));
  const harvest = () => harvestScreen({ skip });
  const candidates = h => h.list.filter(it => it.box).map(it => ({ id: it.id, rect: { x: it.box[0], y: it.box[1], w: it.box[2], h: it.box[3] } }));

  async function capture(h) {
    if (!screenshot) return null;
    root.classList.add('clicky-capturing'); // el blip y la cápsula no salen en la captura
    try {
      const raw = await screenshot();
      return raw && setOfMarks ? await labelShot(raw, h.list, h.map).catch(() => raw) : raw;
    } catch { return null; } finally { root.classList.remove('clicky-capturing'); }
  }

  async function post(path, body, headers) {
    // credentials: el backend exige la cookie de sesión de Mayday (login con GitHub).
    const res = await fetch(api + path, { method: 'POST', credentials: 'include', headers: { ...extraHeaders(), ...headers }, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error([data.message].flat().join('; ') || data.error || res.statusText);
    return data;
  }

  // opts: { annotation: { marks }, harvest, walk: { goal, done }, interrupted }
  async function ask(question, opts = {}) {
    question = String(question || '').trim();
    if (!question || busy) return;
    busy = true;
    const gen = ++askGen;
    if (!opts.walk) { ctx.walk = null; lastQuestion = question; } // una pregunta nueva termina la guía
    let show = null, stepped = false;
    talking = true;
    stepSeen = () => (stepped = true);
    syncPen();
    try {
      island.caption(opts.walk ? `Paso ${opts.walk.done.length} listo. Veo qué sigue…` : '“' + question + '”');
      island.state('thinking');
      // Clear the previous drawing first (quickly), so the capture shows the page and not our marks
      // (the user's own strokes stay: the model has to see them).
      await wipe({ fast: true });
      talking = true; syncPen();
      const h = opts.harvest || harvest();
      alias.clear();
      h.map.forEach((el, id) => alias.set(id, el));
      // Con el foco en un campo de clave no se captura la pantalla (como DuckyHelper).
      const secret = isSecretField(document.activeElement);
      const image = secret ? null : await capture(h);
      gesture.clear();
      const ctxText = typeof context === 'function' ? context() : context;
      if (gen <= clearedGen) return; // «Borrar todo» llegó mientras se capturaba: no se pregunta
      const abort = answering = new AbortController();
      const res = await fetch(api + '/lesson', {
        method: 'POST',
        credentials: 'include',
        headers: { ...extraHeaders(), 'Content-Type': 'application/vnd.clicky+json' },
        body: JSON.stringify({
          question, elements: h.list, viewport: { w: innerWidth, h: innerHeight }, history, screenshot: image,
          page: { title: document.title, path: location.pathname }, context: ctxText, voice: voiceOn,
          annotation: opts.annotation?.marks?.length ? opts.annotation : null,
          walk: opts.walk || null, interrupted: opts.interrupted || '', private: secret,
        }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error([data.message].flat().join('; ') || data.error || res.statusText);
      }
      busy = false; // a new question can interrupt this answer from now on
      if (gen <= clearedGen) return;
      show = director.start();
      const said = [];
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const evt = JSON.parse(line);
          if (evt.type === 'beat') { said.push(evt.say); show.push(evt); }
          else if (evt.type === 'error') show.push({ say: evt.message, marks: [] });
        }
      }
      show.end();
      if (!opts.walk) {
        history.push({ q: question, a: said.join(' ') });
        history = history.slice(-6);
      }
      if (answering === abort) answering = null;
      await show.done;
      if (gen !== askGen) return;
      if (pending) {
        island.caption(`Paso ${ctx.walk.done.length + 1}: ${pending.label}`, { muted: true });
      } else if (ctx.walk && !stepped) {
        // la guía llegó a la meta
        ctx.walk = null;
        sounds.done();
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // another question or clear() took over
      show?.end();
      island.caption('No pude responder: ' + e.message, { error: true });
      island.state('idle');
    } finally {
      if (gen === askGen) {
        busy = false;
        talking = false;
        lastAnswerAt = Date.now();
        syncPen();
      }
    }
  }

  // --- Guía paso a paso: espera a que el usuario apriete el control marcado (o "Hazlo tú"),
  // lo celebra y pide el siguiente paso con una captura nueva, hasta llegar a la meta (máx 15).
  const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable=true]';
  function waitStep({ el, label, lock, card, doIt }) {
    stepSeen();
    if (!ctx.walk) ctx.walk = { goal: lastQuestion, done: [] };
    pending = { el, label: String(label || 'el paso').slice(0, 120), lock, card, field: el.matches(TEXT_FIELD) };
    syncPen();
    card.querySelector('.do').onclick = async e => {
      e.stopPropagation();
      if (!(await doIt()) && pending?.el === el) island.caption('No lo hice. Hazlo tú cuando quieras, o Esc para salir.', { muted: true });
    };
  }
  function completeStep() {
    const p = pending;
    if (!p || !ctx.walk) return;
    pending = null;
    sounds.done();
    p.lock.classList.add('done');
    p.card.classList.add('done');
    p.card.innerHTML = `${checkSvg(16)}<span class="t"></span>`;
    p.card.querySelector('.t').textContent = p.label;
    ctx.walk.done.push(p.label);
    const walk = { goal: ctx.walk.goal, done: [...ctx.walk.done] };
    island.caption(`Paso ${walk.done.length} listo`, { muted: true });
    // un momento para que la página reaccione al clic antes de mirarla de nuevo
    setTimeout(() => { if (ctx.walk?.goal === walk.goal && ctx.walk.done.length === walk.done.length) ask(walk.goal, { walk }); }, 650);
  }
  function stopWalk() {
    if (!ctx.walk && !pending) return;
    ctx.walk = null;
    pending = null;
    wipe({ fast: true });
    island.idle('Guía terminada. Pregúntame cuando quieras.');
  }
  // «Borrar todo» (botón de la barra o Esc): borra lo dibujado (marcas, tarjetas, pizarra, guía y
  // los trazos del usuario), corta la voz y la respuesta en curso, y deja a Hinty esperando.
  // El lápiz deshace los trazos al revés, como borrando la pizarra (con reduced-motion, se desvanece).
  let clearedGen = 0;
  function clearAll() {
    clearedGen = askGen;
    ctx.walk = null;
    pending = null;
    nudging = null;
    gesture.clear();
    dim(false);
    island.clearable(false);
    island.idle('Pantalla limpia. Pregúntame cuando quieras.');
    sounds.done?.();
    wipe({ fast: reducedMotion() }).then(syncPen);
  }
  const hasDrawing = () => !!(ctx.items.length || ctx.strokes.length || ctx.fades.length || ctx.spotHoles.length || pending || ctx.walk || talking || gesture.count);
  const clearTimer = setInterval(() => island.clearable(hasDrawing()), 250);
  const inStep = t => pending && t instanceof Node && (pending.el === t || pending.el.contains(t));
  const onDocClick = e => { if (inStep(e.target) && !pending.field) completeStep(); };
  const onDocChange = e => { if (inStep(e.target)) completeStep(); };
  const onDocEnter = e => { if (e.key === 'Enter' && inStep(e.target) && pending.field) completeStep(); };
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('change', onDocChange, true);
  document.addEventListener('keydown', onDocEnter, true);
  // La mira brilla más a medida que el cursor se acerca al control.
  function glow(x, y) {
    const r = pending.el.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
    pending.lock.style.setProperty('--near', Math.max(0, Math.min(1, 1 - Math.hypot(dx, dy) / 260)).toFixed(2));
  }

  // --- Aviso proactivo: una señal nueva del atacante aparece en pantalla y Hinty vuela hasta ella.
  const seen = new WeakSet();
  // el primer aviso puede llegar 15 s después de encender a Hinty, no apenas se monta la página
  let lastNudge = Date.now() - 30_000, nudgeTimer = 0, nudgeEl = null, mo = null;
  const visibleEl = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  // La señal más nueva espera su turno si Hinty está ocupado (hablando, escuchando o guiando).
  let queued = null, retry = 0;
  function scanNudge() {
    for (const e of document.querySelectorAll(ATTACK)) {
      if (seen.has(e) || e.closest('.clicky-root')) continue;
      seen.add(e);
      if (!(ignore && e.closest(ignore)) && !e.parentElement?.closest(ATTACK) && visibleEl(e)) queued = e;
    }
    tryQueued();
  }
  async function tryQueued() {
    clearTimeout(retry);
    if (!queued?.isConnected) { queued = null; return; }
    if (await nudge(queued)) queued = null;
    else retry = setTimeout(tryQueued, 2500);
  }
  if (proactive && typeof MutationObserver === 'function') {
    document.querySelectorAll(ATTACK).forEach(e => seen.add(e)); // lo que ya estaba no es noticia
    mo = new MutationObserver(muts => {
      if (muts.every(m => root.contains(m.target) || multiply.contains(m.target))) return; // lo nuestro no cuenta
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(scanNudge, 700);
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-attack'] });
  }
  function pointAt(el, h) {
    let id = null, area = Infinity;
    for (const [k, v] of h.map) {
      if (v !== el && !el.contains(v) && !v.contains(el)) continue;
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (v === el) { id = k; break; }
      if (a < area) { area = a; id = k; }
    }
    const r = rectOf(el);
    return id ? { shape: 'point', box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, elements: [id], said: '' } : null;
  }
  function explainNudge(el) {
    const h = harvest(), mark = pointAt(el, h);
    ask('¿Qué es esta nueva señal del atacante?', { harvest: h, annotation: mark ? { marks: [mark] } : null });
  }
  async function nudge(el, { force = false } = {}) {
    const now = Date.now();
    if (!el?.isConnected || listening || busy || talking || pending || ctx.walk) return false;
    if (!force && (now - lastNudge < 45_000 || now - lastAnswerAt < 8_000)) return false;
    lastNudge = now;
    await wipe({ fast: true });
    const token = nudging = {};
    nudgeEl = el;
    syncPen();
    alias.set('nudge', el);
    const res = await marks.ring({ target: 'nudge', tone: 'attack', label: 'Nueva señal del atacante' }, 1);
    if (nudging !== token) return true;
    if (res?.tag) {
      res.tag.classList.add('clicky-nudge');
      res.tag.innerHTML = `Nueva señal del atacante <kbd>${talkKey}</kbd><span>o clic y te explico</span>`;
      res.tag.onclick = () => explainNudge(el);
    }
    island.caption(`Señal nueva del atacante. Mantén ${talkKey} y pregúntame.`, { muted: true });
    setTimeout(() => { if (nudging === token && !listening && !busy) { nudgeEl = null; wipe({ fast: true }); island.idle(); } }, 10_000);
    return true;
  }

  // A live transcription session is requested ahead of time (its token lasts 15 minutes), so
  // pressing the key starts streaming right away.
  const mic = createVoiceInput();
  let sttReady = null;
  function prefetchStt() {
    if (!liveTranscription || sttReady) return;
    const at = Date.now();
    sttReady = post('/stt-session', null).then(({ url }) => ({ url, at }), () => null);
  }
  async function sttUrl() {
    const ready = await sttReady;
    sttReady = null;
    if (ready && Date.now() - ready.at < 12 * 60_000) return ready.url;
    return liveTranscription ? post('/stt-session', null).then(r => r.url, () => null) : null;
  }
  prefetchStt();

  // Si el usuario habla mientras Hinty explica, Hinty se calla y sus marcas se atenúan (no se
  // borran: lo que estaba diciendo sigue a la vista). El modelo sabe en qué frase lo cortaron.
  function interrupt() {
    const said = director.saying;
    if (said) interruptedSay = said;
    director.stop();
    stopSpeaking();
    answering?.abort();
    answering = null;
    ctx.cancelConfirm?.();
    if (ctx.strokes.length || ctx.items.length) dim(true);
  }

  // listening: true mientras se escucha (fn o el botón).
  // latched: sigue escuchando aunque se suelte la tecla (un clic corto en el botón).
  // markMode: el lápiz encendido; con él, mantener shift dibuja con el cursor.
  let listening = null, latched = false, markMode = false;
  async function listen() {
    if (busy || listening) return;
    listening = true;
    latched = false;
    partial = '';
    island.closeInput(); // para que se vea lo que vas diciendo
    sounds.unlock();
    sounds.listen();
    interrupt();
    island.caption('Te escucho…');
    island.state('listening');
    try {
      await mic.start({
        url: liveTranscription ? sttUrl() : null,
        onLevel: v => island.level(v),
        onPartial: t => {
          partial = t;
          island.caption('“' + t + '”');
        },
      });
    } catch (e) {
      listening = null;
      latched = false;
      dim(false);
      island.caption('No tengo acceso al micrófono: ' + e.message, { error: true });
      island.state('idle');
    }
  }
  async function send() {
    if (!listening) return;
    listening = null;
    latched = false;
    if (markMode) gesture.stop();
    const h = harvest(); // ahora, antes de que algo se mueva
    const { text, blob } = await mic.stop();
    prefetchStt();
    let strokes = markMode ? gesture.finish(candidates(h), text || '') : [];
    // Hablando con un aviso en pantalla y sin marcar nada: la pregunta es por ese aviso
    if (!strokes.length && nudging && nudgeEl?.isConnected) { const m = pointAt(nudgeEl, h); if (m) strokes = [m]; }
    const annotation = strokes.length ? { marks: strokes } : null;
    const interrupted = interruptedSay;
    interruptedSay = '';
    const fallback = annotation ? '¿Qué es esto que marqué?' : '';
    if (text) return ask(text, { annotation, harvest: h, interrupted });
    if (!blob || blob.size < 2500) {
      if (fallback) return ask(fallback, { annotation, harvest: h, interrupted });
      gesture.clear();
      dim(false);
      island.idle(`Mantén ${talkKey} o el botón mientras hablas`);
      return;
    }
    island.caption('Transcribiendo…');
    island.state('thinking');
    try {
      const { text: uploaded } = await post('/transcribe', blob, { 'Content-Type': blob.type });
      ask(uploaded || fallback, { annotation, harvest: h, interrupted });
    } catch (e) {
      gesture.clear();
      dim(false);
      island.caption('No pude transcribir lo que dijiste: ' + e.message, { error: true });
      island.state('idle');
    }
  }

  // El botón de hablar: mantenerlo apretado = hablar mientras está apretado; un clic corto lo deja
  // escuchando (así se puede llegar al lápiz) hasta el siguiente clic, que envía.
  let pressedAt = 0, stopOnUp = false;
  function talkButton(t) {
    if (t === 'down') {
      stopOnUp = !!listening;
      pressedAt = performance.now();
      if (!listening) listen();
      return;
    }
    if (!listening) return;
    if (stopOnUp) return send();
    if (performance.now() - pressedAt < 350) latched = true;
    else send();
  }
  // El lápiz enciende y apaga el modo marcar. Encendido no dibuja solo: dibuja mientras se mantiene
  // shift (move). Lo marcado va con la próxima pregunta, hablada o escrita.
  function toggleMark() {
    markMode = !markMode;
    island.marking(markMode);
    if (markMode) {
      if (!listening) island.idle('Modo marcar: mantén shift y mueve el cursor sobre lo que quieras mostrarme');
    } else {
      shiftDraw(false);
      gesture.clear();
      if (!listening && !busy) island.idle();
    }
  }
  let shiftDown = false;
  function shiftDraw(on) {
    if (on === shiftDown) return;
    shiftDown = on;
    document.documentElement.classList.toggle('clicky-drawing', on);
    if (on && !gesture.drawing) gesture.start();
    if (!on) gesture.lift();
  }
  // Una pregunta escrita con el modo marcar lleva lo marcado.
  function typed(q) {
    if (!markMode || !gesture.count) return ask(q);
    const h = harvest();
    const marks = gesture.finish(candidates(h), q);
    return ask(q, marks.length ? { annotation: { marks }, harvest: h } : { harvest: h });
  }

  const hintyInputEmpty = () => { const a = document.activeElement; return a?.tagName === 'INPUT' && root.contains(a) && !a.value; };
  const isTalkKey = e => e.key === pushToTalkKey || e.code === pushToTalkKey;
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const down = e => {
    if (e.key === 'Shift' && markMode) shiftDraw(true);
    if (e.key === 'Escape' && !listening && (!typing() || pending) && hasDrawing()) { clearAll(); return; }
    if (!isTalkKey(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (listening) { e.preventDefault(); return; }
    // fn no escribe nada, así que funciona aunque el foco esté en un campo. Otra tecla (espacio) escribe,
    // salvo en el input de Hinty vacío (un espacio al inicio no sirve).
    if (!e.repeat && (pushToTalkKey === 'Fn' || !typing() || hintyInputEmpty())) { e.preventDefault(); listen(); }
  };
  const up = e => {
    if (e.key === 'Shift') shiftDraw(false);
    if (latched) return; // con un clic corto en el botón, se envía con otro clic
    if (listening && isTalkKey(e)) { e.preventDefault(); send(); }
  };
  const lost = () => { shiftDraw(false); if (listening) send(); };
  const move = e => {
    ctx.pen.cursor(e.clientX, e.clientY);
    if (markMode) shiftDraw(e.shiftKey); // por si shift se apretó o soltó fuera de la ventana
    if (markMode && e.shiftKey) gesture.add(e.clientX, e.clientY);
    if (pending) glow(e.clientX, e.clientY);
  };
  addEventListener('keydown', down);
  addEventListener('keyup', up);
  addEventListener('blur', lost);
  addEventListener('pointermove', move, { passive: true });
  syncPen();

  return {
    ask: q => ask(q),
    clear: opts => { ctx.walk = null; return wipe(opts); },
    /** Lo mismo que «Borrar todo» en la barra: borra todo, corta la voz y vuelve a esperar. */
    clearAll: () => clearAll(),
    setTheme,
    openInput: () => island.openInput(),
    caption: text => island.idle(text),
    setVoice(on) { voiceOn = on; },
    setSounds(on) { soundsOn = on; },
    /** Lleva a Hinty a una señal del atacante (o a la última que apareció) y ofrece explicarla. */
    nudge: el => nudge(el || [...document.querySelectorAll(ATTACK)].reverse().find(visibleEl), { force: true }),
    stopWalk,
    get walking() { return !!ctx.walk; },
    get theme() { return Object.keys(THEMES).find(k => THEMES[k] === current); },
    destroy() {
      wipe({ fast: true });
      document.documentElement.classList.remove('clicky-drawing');
      if (listening) { listening = null; mic.stop(); }
      mo?.disconnect();
      clearTimeout(nudgeTimer);
      clearTimeout(retry);
      clearInterval(clearTimer);
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', lost);
      removeEventListener('pointermove', move);
      removeEventListener('scroll', reflow, { capture: true });
      removeEventListener('resize', reflow);
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('change', onDocChange, true);
      document.removeEventListener('keydown', onDocEnter, true);
      root.remove();
      multiply.remove();
    },
  };
}
