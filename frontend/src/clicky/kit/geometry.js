export const NS = 'http://www.w3.org/2000/svg';

let seed = 7;
export const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

export function svgEl(tag, attrs = {}, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function htmlEl(tag, className, parent, html = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export function rectOf(el, pad = 0) {
  const r = el.getBoundingClientRect();
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
}

export function wobble(points, amp = 1.5) {
  if (!amp) return points;
  const p1 = rnd() * 6, p2 = rnd() * 6;
  return points.map(([x, y], i) => {
    const t = i / points.length;
    return [x + (Math.sin(t * 9 + p1) * 0.6 + Math.sin(t * 23 + p2) * 0.4) * amp, y + Math.cos(t * 13 + p2) * amp * 0.7];
  });
}

export const toD = pts => 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L');

export function smoothD(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0].toFixed(1)},${l[1].toFixed(1)}`;
}

export function ellipsePts(b, { amp = 2, turns = 1.1, padX = 14, padY = 10 } = {}) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2 + padX, ry = b.h / 2 + padY, pts = [];
  for (let i = 0; i <= 96; i++) {
    const a = -2.4 + (i / 96) * Math.PI * 2 * turns, grow = 1 + (i / 96) * 0.07;
    pts.push([cx + Math.cos(a) * rx * grow, cy + Math.sin(a) * ry * grow]);
  }
  return wobble(pts, amp);
}

export function linePts(x1, y1, x2, y2, n = 30, bend = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * bend]);
  }
  return pts;
}

export function rrectPts(x, y, w, h, r = 10, amp = 1.2) {
  const pts = [];
  const seg = (x1, y1, x2, y2) => { for (let i = 0; i <= 8; i++) pts.push([x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8]); };
  const arc = (cx, cy, a0) => { for (let i = 0; i <= 5; i++) { const a = a0 + i / 5 * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  r = Math.min(r, w / 2, h / 2);
  seg(x + r, y, x + w - r, y); arc(x + w - r, y + r, -Math.PI / 2);
  seg(x + w, y + r, x + w, y + h - r); arc(x + w - r, y + h - r, 0);
  seg(x + w - r, y + h, x + r, y + h); arc(x + r, y + h - r, Math.PI / 2);
  seg(x, y + h - r, x, y + r); arc(x + r, y + r, Math.PI);
  pts.push([x + r + 4, y - 1]);
  return wobble(pts, amp);
}

export function edgePoint(r, tx, ty, margin = 6) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
  const s = 1 / Math.max(Math.abs(dx) / (r.w / 2 + margin), Math.abs(dy) / (r.h / 2 + margin));
  return [cx + dx * s, cy + dy * s];
}

export function arrowHeadD(path, size = 12) {
  const L = path.getTotalLength(), e = path.getPointAtLength(L), q = path.getPointAtLength(Math.max(0, L - 10));
  const a = Math.atan2(e.y - q.y, e.x - q.x);
  return toD([[e.x - size * Math.cos(a - 0.5), e.y - size * Math.sin(a - 0.5)], [e.x, e.y], [e.x - size * Math.cos(a + 0.5), e.y - size * Math.sin(a + 0.5)]]);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function animate(seconds, step) {
  return new Promise(done => {
    const t0 = performance.now(), dur = Math.max(1, seconds * 1000);
    (function tick(now) {
      const u = Math.max(0, Math.min((now - t0) / dur, 1));
      step(u);
      u < 1 ? requestAnimationFrame(tick) : done();
    })(t0);
  });
}

export const easeInOut = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
export const easeOut = u => 1 - Math.pow(1 - u, 3);

// --- Trazos rectos de Hinty (wobble 0): rectángulos, codos a 90° y puntas sólidas.

// Rectángulo con esquinas de radio r, empezando arriba a la izquierda y en sentido horario.
export function rectD({ x, y, w, h }, r = 4) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
}

// Une dos rectángulos con una línea de codos a 90°: sale del lado que mira al otro y llega al
// lado opuesto, con un tramo intermedio a medio camino. Devuelve el path y hacia dónde apunta al final.
export function elbow(a, b, margin = 6) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? 1 : -1;
    const x1 = sx > 0 ? a.x + a.w + margin : a.x - margin, x2 = sx > 0 ? b.x - margin : b.x + b.w + margin;
    const mx = Math.round((x1 + x2) / 2);
    const d = Math.abs(dy) < 1 ? `M${x1},${ac.y} H${x2}` : `M${x1},${ac.y} H${mx} V${bc.y} H${x2}`;
    return { d, end: { x: x2, y: bc.y }, dir: sx > 0 ? 'right' : 'left' };
  }
  const sy = dy >= 0 ? 1 : -1;
  const y1 = sy > 0 ? a.y + a.h + margin : a.y - margin, y2 = sy > 0 ? b.y - margin : b.y + b.h + margin;
  const my = Math.round((y1 + y2) / 2);
  const d = Math.abs(dx) < 1 ? `M${ac.x},${y1} V${y2}` : `M${ac.x},${y1} V${my} H${bc.x} V${y2}`;
  return { d, end: { x: bc.x, y: y2 }, dir: sy > 0 ? 'down' : 'up' };
}

// Punta triangular sólida con el vértice en (x, y), apuntando hacia `dir`.
export function tipD({ x, y }, dir, size = 10) {
  const h = size, s = size * 0.6;
  const pts = {
    right: [[x, y], [x - h, y - s], [x - h, y + s]],
    left: [[x, y], [x + h, y - s], [x + h, y + s]],
    down: [[x, y], [x - s, y - h], [x + s, y - h]],
    up: [[x, y], [x - s, y + h], [x + s, y + h]],
  }[dir];
  return 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L') + ' Z';
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
