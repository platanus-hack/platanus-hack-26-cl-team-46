import { svgEl, smoothD } from './geometry.js';

// Lo que el usuario marca mientras mantiene Control + Option (o con el modo marcar y shift), como en HeyClicky: el cursor deja un
// trazo blanco (el del usuario; el cian es de Hinty). Puede hacer varios trazos: si el cursor se
// queda quieto un momento, el trazo se cierra y el siguiente movimiento empieza otro. Cada trazo
// se lee como una forma (encerrar, subrayar o señalar), se cruza con los elementos que cubre y
// guarda lo que el usuario iba diciendo mientras lo hacía ("esto… con esto").
// El trazo queda en pantalla para la captura (el modelo ve lo mismo) y se borra después.
const PAUSE_MS = 320; // quieto este rato: el trazo terminó
const LAG_MS = 800; // el dictado llega con este atraso: las palabras de un trazo se leen después

export function createGesture(parent, { words = () => 0 } = {}) {
  const svg = svgEl('svg', { class: 'clicky-user' }, parent);
  let strokes = [], cur = null, on = false, pause = 0;

  function start() {
    clear(true);
    on = true;
    strokes = [];
    cur = null;
  }

  function lift() {
    clearTimeout(pause);
    if (!cur) return;
    const st = cur;
    cur = null;
    if (!classify(st.pts)) { st.path.remove(); return; }
    strokes.push(st);
    setTimeout(() => { st.to ??= words(); }, LAG_MS);
  }

  function add(x, y) {
    if (!on) return;
    if (!cur) cur = { pts: [], path: svgEl('path', {}, svg), to: null };
    const last = cur.pts.at(-1);
    if (last && Math.hypot(x - last[0], y - last[1]) < 3) return;
    cur.pts.push([x, y]);
    if (cur.pts.length > 1) cur.path.setAttribute('d', smoothD(cur.pts));
    clearTimeout(pause);
    pause = setTimeout(lift, PAUSE_MS);
  }

  // Deja de dibujar (se soltó la tecla) sin borrar lo trazado.
  function stop() { lift(); on = false; }

  // Trazos en orden: [{ shape, box, elements, said }]. `text` es lo que dijo completo.
  function finish(candidates, text = '') {
    stop();
    const all = String(text).split(/\s+/).filter(Boolean);
    let from = 0;
    const out = strokes.map(st => {
      const to = Math.max(from, Math.min(all.length, st.to ?? all.length));
      const said = all.slice(from, to).join(' ');
      from = to;
      const xs = st.pts.map(p => p[0]), ys = st.pts.map(p => p[1]);
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const shape = classify(st.pts);
      return { shape, box: roundBox(box), elements: covered(shape, box, st.pts.at(-1), candidates), said };
    });
    // Llegar con el cursor a algo y después encerrarlo no son dos marcas: el "señalar" que va
    // justo antes de un trazo sobre lo mismo se descarta (y sus palabras pasan al siguiente).
    return out.filter((m, i) => {
      const next = out[i + 1];
      const dup = m.shape === 'point' && next && m.elements.length && m.elements.every(id => next.elements.includes(id));
      if (dup) next.said = [m.said, next.said].filter(Boolean).join(' ');
      return !dup;
    }).slice(0, 6);
  }

  function clear(now = false) {
    clearTimeout(pause);
    on = false;
    strokes = [];
    cur = null;
    if (now) { svg.classList.remove('fading'); svg.innerHTML = ''; return; }
    svg.classList.add('fading');
    setTimeout(() => { svg.innerHTML = ''; svg.classList.remove('fading'); }, 420);
  }

  return { start, add, stop, finish, clear, lift, get drawing() { return on; }, get count() { return strokes.length + (cur && classify(cur.pts) ? 1 : 0); } };
}

const roundBox = b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

function length(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

// circle: it closes on itself and goes around; underline: flat and wide; point: a stroke that ends
// on something. A short wiggle is not a mark.
export function classify(pts) {
  if (pts.length < 4) return null;
  const L = length(pts);
  if (L < 60) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const gap = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
  if (w > 24 && h > 18 && gap < 0.45 * Math.max(w, h) && L > 1.2 * (w + h)) return 'circle';
  if (w > 40 && h < 0.3 * w) return 'underline';
  return 'point';
}

// Elements the mark is about, the best first: inside the circle, right above the underline, or
// under the tip of the line. Up to 4.
export function covered(shape, box, end, candidates) {
  const area = r => Math.max(1, r.w * r.h);
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  let scored = [];
  if (shape === 'circle') {
    // Lo que quedó dentro (al menos la mitad), y primero lo que mejor calza con el círculo: si
    // encierra un mensaje entero es el mensaje, no la hora que va adentro; un panel enorme que
    // contiene al círculo tampoco.
    const iou = r => overlap(r, box) / (area(r) + area(box) - overlap(r, box));
    scored = candidates.map(c => ({ c, k: overlap(c.rect, box) / area(c.rect) })).filter(x => x.k >= 0.5)
      .sort((a, b) => iou(b.c.rect) - iou(a.c.rect));
    if (!scored.length) {
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      scored = candidates.filter(c => inside(c.rect, cx, cy)).map(c => ({ c })).sort((a, b) => area(a.c.rect) - area(b.c.rect));
    }
  } else if (shape === 'underline') {
    const y = box.y + box.h / 2;
    scored = candidates
      .map(c => ({ c, dy: y - (c.rect.y + c.rect.h), k: overlap(c.rect, { x: box.x, y: c.rect.y, w: box.w, h: c.rect.h }) / Math.max(1, Math.min(c.rect.w, box.w)) }))
      .filter(x => x.dy > -14 && x.dy < 34 && x.k > 0.4)
      .sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy) || area(a.c.rect) - area(b.c.rect));
  } else {
    const [x, y] = end;
    scored = candidates.filter(c => inside(c.rect, x, y, 12)).map(c => ({ c })).sort((a, b) => area(a.c.rect) - area(b.c.rect));
  }
  return scored.slice(0, 4).map(x => x.c.id);
}

const inside = (r, x, y, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
