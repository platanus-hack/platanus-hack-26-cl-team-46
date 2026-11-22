// Geometría de la pizarra (board/node/edge), sin DOM, para poder probarla sola.
//
// Cómo arma HeyClicky un diagrama legible, llevado a la grilla de Hinty:
// - Las cajas nunca se tocan: entre columnas y entre filas queda un pasillo fijo, y las flechas viajan
//   por esos pasillos, así que nunca cruzan una caja.
// - Si la pizarra es angosta (más alta que ancha), el diagrama se gira: lo que iba de izquierda a
//   derecha va de arriba hacia abajo, en vez de apretar cajas hasta que se encimen.
// - La etiqueta de una flecha prueba lugares cerca del medio de su tramo más largo, del más cercano al
//   más lejano (lo vertical pesa 1,6 veces: se prefiere correrla a lo largo que alejarla), y se queda
//   en el primero que no pisa una caja, otra etiqueta ni una línea.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Distribuye una grilla de cols × rows en la hoja { W, H, top }. */
export function planLayout({ W, H, top }, cols, rows) {
  const pad = 20;
  // aire bajo el título: el pasillo de arriba de la primera fila también lleva flechas
  const y0min = top + 12;
  const innerW = W - 2 * pad, innerH = H - y0min - pad;
  // El pasillo entre columnas lleva la etiqueta de la flecha (hasta 12 letras): mientras haya ancho,
  // que quepa entera al lado de su flecha. Si no hay, se angosta de a poco antes de achicar las cajas
  // (una caja de menos de 104 px ya no se lee).
  const fit = (c, r, gxWant) => {
    const gx = gxWant ?? clamp(Math.round(innerW * 0.15), 48, 104);
    const gy = gxWant === 36 ? 30 : clamp(Math.round(innerH * 0.14), 40, 64);
    const w = Math.min(184, Math.floor((innerW - (c - 1) * gx) / c));
    const h = Math.min(80, Math.floor((innerH - (r - 1) * gy) / r));
    return { c, r, gx, gy, w, h };
  };
  const best = (c, r) => {
    let L = fit(c, r);
    for (const gx of [72, 60, 48]) if (L.w < 104 && gx < L.gx) L = fit(c, r, gx);
    return L;
  };
  let L = best(cols, rows), transposed = false;
  if (L.w < 104 && rows !== cols) {
    const T = best(rows, cols);
    if (T.w >= L.w * 1.3 && T.h >= 44) { L = T; transposed = true; }
  }
  if (L.w < 96 || L.h < 48) L = fit(L.c, L.r, 36);
  const x0 = Math.round(pad + (innerW - (L.c * L.w + (L.c - 1) * L.gx)) / 2);
  const y0 = Math.round(y0min + (innerH - (L.r * L.h + (L.r - 1) * L.gy)) / 2);
  return { ...L, x0, y0, transposed, W, H, top: y0min, pad };
}

/** Celda (c, r) de la grilla dibujada para la celda (col, row) que pidió el modelo. */
export const cellOf = (L, col, row) => (L.transposed ? { c: row, r: col } : { c: col, r: row });

export function cellRect(L, col, row) {
  const { c, r } = cellOf(L, col, row);
  return { c, r, x: L.x0 + c * (L.w + L.gx), y: L.y0 + r * (L.h + L.gy), w: L.w, h: L.h };
}

// El centro del pasillo entre la columna c y la c + 1 (c = -1: a la izquierda de la primera).
const colGap = (L, c) => L.x0 + c * (L.w + L.gx) + L.w + L.gx / 2;
// El centro del pasillo entre la fila r y la r + 1 (r = -1: sobre la primera).
const rowGap = (L, r) => L.y0 + r * (L.h + L.gy) + L.h + L.gy / 2;

/**
 * El camino de una flecha entre dos cajas (con su id, c y r), como lista de puntos en ángulo recto.
 * Las flechas solo andan por los pasillos (entre columnas y entre filas), así que nunca cruzan una
 * caja, ni siquiera una que se dibuje después. Prueba todas las salidas y entradas (4 × 4 lados) y se
 * queda con el camino más barato: corto, con pocas curvas, sin cruzar otras flechas ni ir encima de
 * ellas, y sin mezclar en un mismo lado flechas que entran con flechas que salen.
 * `used` guarda los puertos y tramos ya dibujados de la pizarra; `labels`, las etiquetas ya escritas
 * (una flecha nueva no pasa por encima de ellas si tiene otro camino).
 */
export function route(L, A, B, used = {}, labels = []) {
  used.segs ||= [];
  used.ports ||= {};
  const m = 6; // la flecha no toca la caja
  const cx = R => R.x + R.w / 2, cy = R => R.y + R.h / 2;
  const horiz = s => s === 'r' || s === 'l';
  // el pasillo pegado a cada lado de la caja (null si queda fuera de la hoja)
  const lane = (R, s) => {
    const v = s === 'r' ? colGap(L, R.c) : s === 'l' ? colGap(L, R.c - 1) : s === 't' ? rowGap(L, R.r - 1) : rowGap(L, R.r);
    const outer = s === 'r' ? R.c === L.c - 1 : s === 'l' ? R.c === 0 : s === 't' ? R.r === 0 : R.r === L.r - 1;
    const ok = horiz(s) ? v > 6 && v < L.W - 6 : v > L.top - 4 && v < L.H - 6;
    return ok ? { v, outer } : null;
  };
  const vLanes = [], hLanes = [];
  for (let k = -1; k < L.c; k++) { const x = colGap(L, k); if (x > 6 && x < L.W - 6) vLanes.push({ v: x, outer: k < 0 || k === L.c - 1 }); }
  for (let k = -1; k < L.r; k++) { const y = rowGap(L, k); if (y > L.top - 4 && y < L.H - 6) hLanes.push({ v: y, outer: k < 0 || k === L.r - 1 }); }

  // varios puertos en un mismo lado se reparten a lo largo de él
  const OFFS = [0, -14, 14, -28, 28];
  const offsFor = (R, s) => {
    const lim = (horiz(s) ? R.h : R.w) / 2 - 8, taken = used.ports[`${R.id}:${s}`] || [];
    return OFFS.filter(o => Math.abs(o) <= lim && !taken.some(t => t.off === o));
  };
  const port = (R, s, off) =>
    s === 'r' ? [R.x + R.w + m, cy(R) + off] : s === 'l' ? [R.x - m, cy(R) + off] : s === 't' ? [cx(R) + off, R.y - m] : [cx(R) + off, R.y + R.h + m];
  const sidePenalty = (R, s, dir) => (used.ports[`${R.id}:${s}`] || []).reduce((p, t) => p + (t.dir === dir ? 8 : 70), 0);

  const cands = [];
  const push = (pts, sa, oa, sb, ob, outer = 0) => cands.push({ pts, sa, oa, sb, ob, outer });
  // vecinas de frente: una línea recta, con el mismo desplazamiento en las dos cajas
  const dc = B.c - A.c, dr = B.r - A.r;
  if ((dr === 0 && Math.abs(dc) === 1) || (dc === 0 && Math.abs(dr) === 1)) {
    const sa = dr === 0 ? (dc > 0 ? 'r' : 'l') : dr > 0 ? 'b' : 't';
    const sb = { r: 'l', l: 'r', t: 'b', b: 't' }[sa];
    const fb = offsFor(B, sb), off = offsFor(A, sa).find(o => fb.includes(o));
    if (off !== undefined) push([port(A, sa, off), port(B, sb, off)], sa, off, sb, off);
  }
  for (const sa of ['r', 'b', 'l', 't'])
    for (const sb of ['l', 't', 'r', 'b']) {
      const la = lane(A, sa), lb = lane(B, sb);
      if (!la || !lb) continue;
      const oa = offsFor(A, sa)[0] ?? 0, ob = offsFor(B, sb)[0] ?? 0;
      const pa = port(A, sa, oa), pb = port(B, sb, ob);
      const out = (la.outer ? 1 : 0) + (lb.outer ? 1 : 0);
      if (horiz(sa) && horiz(sb)) {
        if (la.v === lb.v) push([pa, [la.v, pa[1]], [la.v, pb[1]], pb], sa, oa, sb, ob, out);
        else for (const h of hLanes) push([pa, [la.v, pa[1]], [la.v, h.v], [lb.v, h.v], [lb.v, pb[1]], pb], sa, oa, sb, ob, out + (h.outer ? 1 : 0));
      } else if (!horiz(sa) && !horiz(sb)) {
        if (la.v === lb.v) push([pa, [pa[0], la.v], [pb[0], la.v], pb], sa, oa, sb, ob, out);
        else for (const w of vLanes) push([pa, [pa[0], la.v], [w.v, la.v], [w.v, lb.v], [pb[0], lb.v], pb], sa, oa, sb, ob, out + (w.outer ? 1 : 0));
      } else if (horiz(sa)) push([pa, [la.v, pa[1]], [la.v, lb.v], [pb[0], lb.v], pb], sa, oa, sb, ob, out);
      else push([pa, [pa[0], la.v], [lb.v, la.v], [lb.v, pb[1]], pb], sa, oa, sb, ob, out);
    }

  let best = null;
  for (const c of cands) {
    const pts = simplify(c.pts);
    const extra = separate(pts, used.segs);
    const segs = toSegs(pts);
    const len = segs.reduce((s, g) => s + g.len, 0);
    const crossings = segs.reduce((n, g) => n + used.segs.filter(o => crosses(g, o)).length, 0);
    // vuelve sobre sí misma (sale hacia un lado para volver): se ve torpe
    const back = segs.some((g, i) => i > 0 && g.dir === -segs[i - 1].dir && g.vertical === segs[i - 1].vertical) ? 200 : 0;
    const overLabels = labels.reduce((n, b) => n + segmentBoxes(pts, 2).filter(o => overlap(o, b) > 0).length, 0);
    const cost = len + 26 * (segs.length - 1) + 70 * crossings + 30 * c.outer + 120 * overLabels + extra + back +
      sidePenalty(A, c.sa, 'out') + sidePenalty(B, c.sb, 'in') + (c.oa || c.ob ? 4 : 0);
    if (!best || cost < best.cost) best = { ...c, pts, segs, cost };
  }
  (used.ports[`${A.id}:${best.sa}`] ||= []).push({ off: best.oa, dir: 'out' });
  (used.ports[`${B.id}:${best.sb}`] ||= []).push({ off: best.ob, dir: 'in' });
  used.segs.push(...best.segs);
  return best.pts;
}

// sin puntos repetidos ni puntos en medio de una recta
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5) continue;
    out.push([p[0], p[1]]);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if ((Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5)) out.splice(i, 1);
  }
  return out;
}

function toSegs(pts) {
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]], vertical = Math.abs(a[0] - b[0]) < 0.5;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir = vertical ? Math.sign(b[1] - a[1]) : Math.sign(b[0] - a[0]);
    segs.push(vertical
      ? { vertical, at: a[0], lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]), len, dir }
      : { vertical, at: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]), len, dir });
  }
  return segs;
}

const crosses = (g, o) => g.vertical !== o.vertical && o.at > g.lo + 1 && o.at < g.hi - 1 && g.at > o.lo + 1 && g.at < o.hi - 1;
const runsOver = (g, o, gap = 7) => g.vertical === o.vertical && Math.abs(g.at - o.at) < gap && Math.min(g.hi, o.hi) - Math.max(g.lo, o.lo) > 2;

// Los tramos interiores que irían encima de otra flecha se corren de a 10 px dentro del pasillo.
// Devuelve el castigo si alguno no encontró lugar.
function separate(pts, segs) {
  let extra = 0;
  for (let i = 1; i < pts.length - 2; i++) {
    const a = pts[i], b = pts[i + 1], vertical = Math.abs(a[0] - b[0]) < 0.5, k = vertical ? 0 : 1;
    const base = a[k];
    let ok = false;
    for (const d of [0, 10, -10, 20, -20]) {
      a[k] = b[k] = base + d;
      const [g] = toSegs([a, b]);
      if (!segs.some(o => runsOver(g, o))) { ok = true; break; }
    }
    if (!ok) { a[k] = b[k] = base; extra += 250; }
  }
  // los tramos que salen o llegan a una caja tampoco deberían ir encima de otro
  for (const g of toSegs(pts)) if (segs.some(o => runsOver(g, o, 4))) extra += 250;
  return extra;
}

/** Path SVG de una polilínea con las esquinas redondeadas (radio r). */
export function roundedPath(pts, r = 8) {
  const f = v => Math.round(v * 10) / 10;
  if (pts.length < 3) return `M${f(pts[0][0])},${f(pts[0][1])} L${f(pts[1][0])},${f(pts[1][1])}`;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, q, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]), l2 = Math.hypot(n[0] - q[0], n[1] - q[1]);
    const k = Math.min(r, l1 / 2, l2 / 2);
    const a = [q[0] + ((p[0] - q[0]) / (l1 || 1)) * k, q[1] + ((p[1] - q[1]) / (l1 || 1)) * k];
    const b = [q[0] + ((n[0] - q[0]) / (l2 || 1)) * k, q[1] + ((n[1] - q[1]) / (l2 || 1)) * k];
    d += ` L${f(a[0])},${f(a[1])} Q${f(q[0])},${f(q[1])} ${f(b[0])},${f(b[1])}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${f(z[0])},${f(z[1])}`;
}

/** Hacia dónde apunta el último tramo. */
export function endDir(pts) {
  const [p, q] = [pts[pts.length - 2], pts[pts.length - 1]];
  const dx = q[0] - p[0], dy = q[1] - p[1];
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Cajas finas alrededor de cada tramo de una polilínea (para que nada se escriba encima). */
export function segmentBoxes(pts, pad = 3) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    out.push({ x: Math.min(a[0], b[0]) - pad, y: Math.min(a[1], b[1]) - pad, w: Math.abs(b[0] - a[0]) + 2 * pad, h: Math.abs(b[1] - a[1]) + 2 * pad });
  }
  return out;
}

/**
 * Dónde va la etiqueta { w, h } de una flecha. Prueba junto al medio del tramo más largo (arriba o
 * abajo si es horizontal, a la derecha o izquierda si es vertical), después a lo largo del tramo y más
 * lejos, de lo más cercano a lo más lejano. Devuelve la caja { x, y, w, h } libre o, si no hay, la que
 * menos pisa.
 */
export function placeLabel(pts, size, { obstacles = [], bounds }) {
  const { w, h } = size;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    segs.push({ a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), horizontal: Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) });
  }
  const longest = segs.reduce((p, q) => (q.len > p.len ? q : p));
  const mid = [(longest.a[0] + longest.b[0]) / 2, (longest.a[1] + longest.b[1]) / 2];
  const cands = [];
  for (const s of [longest, ...segs.filter(s => s !== longest)])
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const p = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
      for (let k = 0; k <= 5; k++)
        for (const side of [-1, 1]) {
          const push = k * 8;
          const c = s.horizontal ? [p[0], p[1] + side * (h / 2 + 5 + push)] : [p[0] + side * (w / 2 + 8 + push), p[1]];
          cands.push({ x: c[0] - w / 2, y: c[1] - h / 2, w, h, d: Math.hypot(c[0] - mid[0], (c[1] - mid[1]) * 1.6) + (s === longest ? 0 : 6) });
        }
    }
  // sobre la línea, como HeyClicky escribe la etiqueta en el medio de la flecha: el halo del texto corta
  // el trazo. Va después de los lugares libres junto a la línea, pero antes que alejarla de su flecha.
  for (const s of [longest, ...segs.filter(s => s !== longest)])
    for (const t of [0.5, 0.35, 0.65]) {
      const p = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
      cands.push({ x: p[0] - w / 2, y: p[1] - h / 2, w, h, on: true, d: 34 + Math.hypot(p[0] - mid[0], (p[1] - mid[1]) * 1.6) + (s === longest ? 0 : 6) });
    }
  cands.sort((p, q) => p.d - q.d);
  const inside = b => !bounds || (b.x >= bounds.x && b.y >= bounds.y && b.x + b.w <= bounds.x + bounds.w && b.y + b.h <= bounds.y + bounds.h);
  const own = segmentBoxes(pts, 2);
  const hit = b => obstacles.reduce((s, o) => s + overlap(b, o), 0) + (b.on ? 0 : own.reduce((s, o) => s + overlap(b, o), 0));
  let best = null, bestHit = Infinity;
  for (const c of cands) {
    if (!inside(c)) continue;
    const v = hit(c);
    if (v === 0) return { x: c.x, y: c.y, w, h };
    if (v < bestHit) { best = c; bestHit = v; }
  }
  const b = best || cands[0];
  return { x: b.x, y: b.y, w, h };
}

/**
 * El espacio libre más grande para un papelito de ancho mínimo `minW`: celdas sin caja (juntando las
 * vecinas de una fila) o la franja bajo la grilla. Evita las líneas ya dibujadas.
 */
export function freeSpot(L, occupied, lines, { minW = 150, minH = 56 } = {}) {
  const spots = [];
  for (let r = 0; r < L.r; r++) {
    let c = 0;
    while (c < L.c) {
      if (occupied.has(`${c},${r}`)) { c++; continue; }
      let e = c;
      while (e + 1 < L.c && !occupied.has(`${e + 1},${r}`)) e++;
      const x = L.x0 + c * (L.w + L.gx), y = L.y0 + r * (L.h + L.gy);
      spots.push({ x, y, w: (e - c + 1) * L.w + (e - c) * L.gx, h: L.h });
      c = e + 1;
    }
  }
  const gridBottom = L.y0 + L.r * L.h + (L.r - 1) * L.gy;
  const below = L.H - L.pad - (gridBottom + 16);
  if (below >= minH) spots.push({ x: L.pad, y: gridBottom + 16, w: L.W - 2 * L.pad, h: below });
  const clear = s => !lines.some(o => overlap(s, o) > 0);
  return spots.filter(s => s.w >= minW && s.h >= minH * 0.8 && clear(s)).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
}
