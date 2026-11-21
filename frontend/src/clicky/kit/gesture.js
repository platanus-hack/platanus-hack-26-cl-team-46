import { svgEl, smoothD } from './geometry.js';

// What the user marks while holding Control + Option, as in HeyClicky: the cursor leaves a marker
// trail; on release it is read as a shape (circle, underline or a line pointing at something) and
// matched to the elements it covers. The trail stays on screen for the capture, so the model sees
// exactly what was marked, and goes away once the capture is taken.
export function createGesture(parent) {
  const svg = svgEl('svg', { class: 'clicky-user' }, parent);
  let pts = [], path = null, on = false;

  function start() {
    clear(true);
    on = true;
    pts = [];
    path = svgEl('path', {}, svg);
  }

  function add(x, y) {
    if (!on) return;
    const last = pts.at(-1);
    if (last && Math.hypot(x - last[0], y - last[1]) < 3) return;
    pts.push([x, y]);
    if (pts.length > 1) path.setAttribute('d', smoothD(pts));
  }

  // { shape, box, elements } or null when the cursor barely moved (a plain push-to-talk).
  function finish(candidates) {
    on = false;
    const shape = classify(pts);
    if (!shape) { clear(true); return null; }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const end = pts.at(-1);
    return { shape, box: roundBox(box), elements: covered(shape, box, end, candidates) };
  }

  function clear(now = false) {
    on = false;
    pts = [];
    if (now) { svg.classList.remove('fading'); svg.innerHTML = ''; return; }
    svg.classList.add('fading');
    setTimeout(() => { svg.innerHTML = ''; svg.classList.remove('fading'); }, 420);
  }

  return { start, add, finish, clear, get drawing() { return on; } };
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
    scored = candidates.map(c => ({ c, k: overlap(c.rect, box) / area(c.rect) })).filter(x => x.k >= 0.5)
      // lo más chico que quedó dentro es lo que encerró; un panel enorme que lo contiene no
      .sort((a, b) => area(a.c.rect) - area(b.c.rect));
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
