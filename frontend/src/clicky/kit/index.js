import { svgEl, htmlEl, sleep, animate } from './geometry.js';
import { THEMES } from './theme.js';
import { createPen } from './pen.js';
import { createMarks } from './marks.js';
import { createCards } from './cards.js';
import { createIsland } from './island.js';
import { createVoiceInput, stopSpeaking } from './voice.js';
import { createDirector } from './director.js';

// Public entry point. Mount once on any page:
//   const clicky = createClicky({ api: 'https://api.example.com/clicky', headers: () => ({ 'x-sim-id': id }) })
// Elements Clicky may point at need an id and data-clicky="short description".
// With autoTag, visible headings, buttons, links, fields, tables… are tagged on the fly.
// Free space for charts and cards: data-clicky-region="board" and data-clicky-region="side".
// screenshot: async () => dataURL | null, a capture of what the user sees right now.
// context: string (or () => string) describing the app, sent with every question.
// headers: () => object, extra headers for every request (the backend needs x-sim-id).
// The answer streams in (NDJSON, one beat per line) and plays as it arrives. Beats may carry
// their voice already synthesized (beat.audio); otherwise the browser speaks.
// liveTranscription: while push-to-talk is held, the audio goes to the backend's realtime
// transcription session (POST /stt-session); if that fails the clip is uploaded (POST /transcribe).
export function createClicky({
  api = '/clicky', headers: extraHeaders = () => ({}), theme = 'sketch', voice = true, pushToTalkKey = 'Space', cssHref = '/clicky/styles.css',
  hint, screenshot, context = '', autoTag = true, ignore = '[data-clicky-ignore]', surface = 'light', liveTranscription = true,
} = {}) {
  if (!document.querySelector('link[data-clicky-css]')) {
    const link = htmlEl('link', '', document.head);
    link.rel = 'stylesheet';
    link.href = cssHref;
    link.dataset.clickyCss = '';
  }

  const multiply = htmlEl('div', 'clicky-root', document.body);
  multiply.style.mixBlendMode = 'multiply';
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
  svgEl('defs', {}, layers.marks).innerHTML = '<filter id="clicky-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';

  let current = THEMES[theme] || THEMES.sketch, voiceOn = voice, history = [], busy = false, answering = null;
  const ctx = {
    layers, themes: THEMES, theme: () => current,
    strokes: [], items: [], fades: [], spotHoles: [], sideY: 0, board: null, actions: null, surface,
    onAsk: q => ask(q),
    renderSpotlight() {
      layers.spot.innerHTML = '';
      const m = svgEl('mask', { id: 'clicky-spot-mask' }, svgEl('defs', {}, layers.spot));
      svgEl('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: '#fff' }, m);
      ctx.spotHoles.forEach(b => svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10, fill: '#000' }, m));
      const dim = (surface === 'dark' && current.onDark?.spotlight) || current.spotlight;
      svgEl('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: dim, mask: 'url(#clicky-spot-mask)' }, layers.spot);
    },
  };
  ctx.pen = createPen(layers.top, () => current);
  const marks = createMarks(ctx), cards = createCards(ctx);
  const draw = (m, s) => (marks[m.type] || cards[m.type])?.(m, s);

  const island = createIsland(root, { hint: hint ?? (pushToTalkKey === 'Space' ? 'mantén espacio' : pushToTalkKey), onType: q => ask(q) });
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
    for (const [k, v] of Object.entries({ '--c-ink': current.ink, '--c-mark': current.mark, '--c-hot': current.hot, '--c-hl': current.highlighter, '--c-pen': current.pen }))
      [root, multiply].forEach(r => r.style.setProperty(k, v));
  }
  setTheme(theme);
  island.idle();

  // Erases the drawing. `fast`: a quick fade instead of running the pen backwards, used when a
  // new question comes in, so the screen is clean for the capture without making anyone wait.
  async function clear({ fast = false } = {}) {
    director.stop();
    stopSpeaking();
    answering?.abort();
    answering = null;
    const items = ctx.items.splice(0), strokes = ctx.strokes.splice(0).reverse(), fades = ctx.fades.splice(0);
    items.forEach(el => el.classList.add('clicky-out'));
    fades.forEach(el => animate(0.3, u => el.setAttribute('opacity', 0.08 * (1 - u))));
    if (ctx.spotHoles.length) animate(fast ? 0.15 : 0.3, u => layers.spot.style.opacity = 1 - u);
    if (fast) {
      await Promise.all(strokes.map(({ path }) => animate(0.15, u => path.setAttribute('opacity', 1 - u)).then(() => path.remove())));
      items.forEach(el => (el.style.transition = 'opacity .15s'));
    } else {
      const per = Math.min(0.14, 0.9 / Math.max(1, strokes.length));
      for (const { path } of strokes) await ctx.pen.erase(path, per);
    }
    await sleep(fast ? 160 : 300);
    items.forEach(el => el.remove());
    fades.forEach(el => el.remove());
    ctx.spotHoles = []; ctx.sideY = 0; ctx.board = null; ctx.flow = null; ctx.actions = null;
    layers.spot.innerHTML = ''; layers.spot.style.opacity = 0;
    ctx.pen.hide();
  }

  // Visible elements the model may point at: the ones the page marked with data-clicky and,
  // with autoTag, the meaningful ones it did not (they get an id and a short kind).
  const AUTO = { H1: 'título', H2: 'título', H3: 'subtítulo', H4: 'subtítulo', BUTTON: 'botón', A: 'enlace', INPUT: 'campo', SELECT: 'selector', TEXTAREA: 'campo de texto', TABLE: 'tabla', PRE: 'bloque de código', LI: 'ítem', LABEL: 'etiqueta', P: 'texto', IMG: 'imagen', SUMMARY: 'desplegable' };
  let autoSeq = 0;
  const onScreen = r => r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const skip = e => e.closest('.clicky-root') || (ignore && e.closest(ignore));
  function autoTagScreen() {
    const sel = Object.keys(AUTO).map(t => t.toLowerCase()).join(',') + ',[role=button],[role=alert],[role=status]';
    let n = 0;
    for (const e of document.querySelectorAll(sel)) {
      if (n >= 90) break;
      if (e.hasAttribute('data-clicky') || skip(e) || !onScreen(e.getBoundingClientRect())) continue;
      if (e.parentElement?.closest('button,a,label,li,p,pre,table')) continue; // the container already covers it
      const text = (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.alt || '').trim();
      if (!text) continue;
      if (!e.id) e.id = 'ck-' + (++autoSeq);
      e.setAttribute('data-clicky', AUTO[e.tagName] || e.getAttribute('role') || 'elemento');
      e.setAttribute('data-clicky-auto', '');
      n++;
    }
  }
  function screenElements() {
    if (autoTag) autoTagScreen();
    return [...document.querySelectorAll('[data-clicky]')].filter(e => e.id && !skip(e) && e.getClientRects().length && onScreen(e.getBoundingClientRect())).slice(0, 120).map(e => ({
      id: e.id, kind: e.dataset.clicky,
      text: (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.alt || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, e.tagName === 'TABLE' || e.tagName === 'PRE' ? 1500 : 160),
    }));
  }

  async function post(path, body, headers) {
    const res = await fetch(api + path, { method: 'POST', headers: { ...extraHeaders(), ...headers }, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error([data.message].flat().join('; ') || data.error || res.statusText);
    return data;
  }

  async function ask(question) {
    question = String(question || '').trim();
    if (!question || busy) return;
    busy = true;
    let show = null;
    try {
      island.caption('“' + question + '”');
      island.state('thinking');
      // Clear the previous drawing first (quickly), so the capture shows the page and not our marks.
      await clear({ fast: true });
      const image = screenshot ? await screenshot().catch(() => null) : null;
      const page = { title: document.title, path: location.pathname };
      const ctxText = typeof context === 'function' ? context() : context;
      const abort = answering = new AbortController();
      const res = await fetch(api + '/lesson', {
        method: 'POST',
        headers: { ...extraHeaders(), 'Content-Type': 'application/vnd.clicky+json' },
        body: JSON.stringify({ question, elements: screenElements(), history, screenshot: image, page, context: ctxText, voice: voiceOn }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error([data.message].flat().join('; ') || data.error || res.statusText);
      }
      busy = false; // a new question can interrupt this answer from now on
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
      history.push({ q: question, a: said.join(' ') });
      history = history.slice(-6);
      if (answering === abort) answering = null;
      await show.done;
    } catch (e) {
      if (e.name === 'AbortError') return; // another question or clear() took over
      show?.end();
      island.caption('No pude responder: ' + e.message);
      island.state('idle');
    } finally {
      busy = false;
    }
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

  let listening = false;
  async function listen() {
    if (busy || listening) return;
    listening = true;
    try {
      clear({ fast: true }); // in parallel: the microphone must not miss the first words
      island.caption('Te escucho…');
      island.state('listening');
      await mic.start({ url: liveTranscription ? sttUrl() : null, onLevel: v => island.level(v), onPartial: t => island.caption('“' + t + '”') });
    } catch (e) { listening = false; island.caption('Sin micrófono: ' + e.message); island.state('idle'); }
  }
  async function send() {
    if (!listening) return;
    listening = false;
    const { text, blob } = await mic.stop();
    prefetchStt();
    if (text) return ask(text);
    if (!blob || blob.size < 2500) { island.idle('Mantén apretado mientras hablas'); return; }
    island.caption('Transcribiendo…');
    island.state('thinking');
    try {
      const { text: uploaded } = await post('/transcribe', blob, { 'Content-Type': blob.type });
      ask(uploaded);
    } catch (e) { island.caption('No pude transcribir: ' + e.message); island.state('idle'); }
  }
  const typing = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const down = e => { if (e.code === pushToTalkKey && !e.repeat && !typing()) { e.preventDefault(); listen(); } };
  const up = e => { if (e.code === pushToTalkKey && !typing()) { e.preventDefault(); send(); } };
  addEventListener('keydown', down);
  addEventListener('keyup', up);

  return {
    ask, clear, setTheme,
    openInput: () => island.openInput(),
    caption: text => island.idle(text),
    setVoice(on) { voiceOn = on; },
    get theme() { return Object.keys(THEMES).find(k => THEMES[k] === current); },
    destroy() { clear({ fast: true }); if (listening) { listening = false; mic.stop(); } removeEventListener('keydown', down); removeEventListener('keyup', up); root.remove(); multiply.remove(); },
  };
}
