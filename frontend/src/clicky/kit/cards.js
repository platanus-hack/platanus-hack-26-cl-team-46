import { svgEl, htmlEl, rectOf, sleep, animate, elbow, tipD } from './geometry.js';
import { headsetSvg, checkSvg } from './icons.js';

// Paneles en espacio libre (DESIGN.md › Hinty › 6, 7 y 11): la pizarra (board/node/edge y chart)
// y una columna para la card de conclusión, las notas y los botones de la siguiente pregunta.
// La página marca ese espacio con data-clicky-region:
//   "stage"      → donde va la pizarra (en /simulate, la ventana de Chrome), centrada, máx 720×440.
//   "stage-side" → la columna de tarjetas (320 px pegada al borde derecho de Chrome).
//   "board" / "side" → regiones antiguas, de respaldo.
// Ninguna región cae sobre el panel del Agente.
const BOARD_MAX = { w: 720, h: 440 }, GAP = 16, GRID = 24;
const snap = v => Math.round(v / GRID) * GRID;

export function createCards(ctx) {
  const { layers, pen, theme } = ctx;

  const regionEl = name => document.querySelector(`[data-clicky-region="${name}"]`);
  const regionRect = name => { const el = regionEl(name); return el && el.getClientRects().length ? rectOf(el) : null; };
  // Los paneles empiezan bajo la isla para que no les tape el encabezado.
  const belowIsland = r => {
    const isl = layers.panels.parentElement?.querySelector('.clicky-island')?.getBoundingClientRect();
    if (!r || !isl || !isl.height || isl.left > r.x + r.w || isl.right < r.x) return r;
    const top = Math.max(r.y, isl.bottom + 12);
    return { ...r, y: top, h: r.h - (top - r.y) };
  };

  function sideRegion() {
    return belowIsland(regionRect('stage-side') || regionRect('side')) || { x: innerWidth - 360, y: 120, w: 320, h: innerHeight - 160 };
  }

  function boardRegion() {
    const stage = belowIsland(regionRect('stage'));
    if (stage) {
      // centrada en lo que deja libre la columna de tarjetas, para que no se tapen entre sí
      const side = belowIsland(regionRect('stage-side'));
      const free = side && side.x > stage.x ? { ...stage, w: side.x - stage.x - GAP } : stage;
      const w = Math.min(BOARD_MAX.w, free.w - 2 * GAP), h = Math.min(BOARD_MAX.h, free.h - 2 * GAP);
      if (w >= 320 && h >= 220) return { x: Math.round(free.x + (free.w - w) / 2), y: Math.round(free.y + (free.h - h) / 2), w, h };
    }
    return regionRect('board') || { x: 40, y: innerHeight * 0.45, w: Math.min(620, innerWidth * 0.5), h: innerHeight * 0.45 };
  }

  function panel(className, r) {
    const el = htmlEl('div', `clicky-panel ${className} clicky-pop`, layers.panels);
    Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px' });
    if (r.h) el.style.height = r.h + 'px';
    ctx.items.push(el);
    return el;
  }

  function sidePanel(className) {
    const r = sideRegion();
    return panel(className, { x: r.x, y: r.y + ctx.sideY, w: r.w });
  }
  const advance = el => { ctx.sideY += el.offsetHeight + 12; };

  // La pantalla del radar: fondo hinty-board con grilla de 24 px y encabezado "PIZARRA".
  function board(title, sub) {
    ctx.board?.classList.add('clicky-out');
    const r = boardRegion();
    const el = panel('clicky-board', r);
    el.innerHTML = `<div class="hd"><div class="kicker">${headsetSvg(16)}<span>Pizarra</span></div><div class="ttl">${esc(title || '')}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
    const svg = svgEl('svg', {}, el);
    ctx.board = el;
    const hd = el.querySelector('.hd');
    const top = Math.ceil((hd.offsetTop + hd.offsetHeight + 12) / GRID) * GRID;
    return { el, svg, r, W: r.w, H: r.h, top };
  }

  function text(svg, x, y, t, style) {
    const e = svgEl('text', { x, y, 'text-anchor': 'middle' }, svg, t);
    e.setAttribute('style', style);
    return e;
  }

  return {
    // chart: barras horizontales, una fila cada una. La destacada en cian con su valor grande.
    async chart({ title, subtitle, bars, highlight, note }, s = 1) {
      const B = board(title, subtitle);
      await sleep(160 * s);
      const list = htmlEl('div', 'clicky-chart', B.el);
      list.style.top = B.top + 'px';
      const max = Math.max(...bars.map(b => b.value), 0) || 1;
      for (const { label, value } of bars) {
        const hot = label === highlight;
        const row = htmlEl('div', 'row clicky-pop' + (hot ? ' hot' : ''), list,
          `<span class="lbl">${esc(label)}</span><span class="track"><i></i></span><span class="val">${esc(String(value))}${hot && note ? ` <em>${esc(note)}</em>` : ''}</span>`);
        const track = row.querySelector('.track'), bar = track.querySelector('i');
        const pct = Math.max(0.02, value / max);
        const r = rectOf(track);
        const grow = Math.min(0.5, 0.25 + (r.w * pct) / 1200) * Math.min(1, s);
        await pen.travel(r.x, r.y + r.h / 2, 0.2 * s);
        pen.travel(r.x + r.w * pct, r.y + r.h / 2, grow);
        await animate(grow, u => (bar.style.width = `${pct * 100 * u}%`));
        await sleep(60 * s);
      }
      await sleep(120 * s);
    },

    // Pizarra narrada: board abre la hoja con su grilla, cada node pone una caja en su celda cuando la
    // voz la nombra y cada edge une dos cajas ya dibujadas. La grilla fija dónde va cada caja aunque
    // las demás no hayan llegado.
    async board({ title, subtitle, cols = 3, rows = 2 }, s = 1) {
      const B = board(title, subtitle);
      ctx.flow = { B, cols, rows, pos: {}, labels: [], active: null };
      await sleep(200 * s);
    },

    async node({ id, text: label, col = 0, row = 0, hot }, s = 1) {
      const F = ctx.flow;
      if (!F) return;
      const { B } = F, pad = GRID;
      const cw = (B.W - 2 * pad - (F.cols - 1) * GRID) / F.cols, ch = (B.H - B.top - pad - (F.rows - 1) * GRID) / F.rows;
      // la caja no llena la celda: deja aire para las flechas y sus etiquetas
      const w = Math.max(96, Math.floor(Math.min(192, cw - 40) / GRID) * GRID), h = ch >= 96 ? 72 : 48;
      const x = snap(pad + col * (cw + GRID) + (cw - w) / 2), y = snap(B.top + row * (ch + GRID) + (ch - h) / 2);
      const r = { x, y, w, h };
      F.pos[id] = r;
      F.labels.push(r);
      await pen.travel(B.r.x + x, B.r.y + y, 0.3 * s);
      const el = htmlEl('div', 'clicky-node' + (hot ? ' hot' : ''), B.el, `<span>${esc(label)}</span>`);
      Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      const fits = () => el.firstChild.scrollHeight <= h - 8 && el.firstChild.scrollWidth <= el.firstChild.clientWidth;
      if (!fits()) el.classList.add('small');
      await sleep(240 * Math.min(1, s));
    },

    async edge({ from, to, label }, s = 1) {
      const F = ctx.flow, A = F?.pos[from], Bn = F?.pos[to];
      if (!A || !Bn) return;
      const t = theme(), { B } = F;
      // la flecha que se está explicando va en cian; la anterior pasa a line-strong
      if (F.active) {
        F.active.p.setAttribute('stroke', t.line);
        F.active.tip.setAttribute('fill', t.line);
      }
      const { d, end, dir } = elbow(A, Bn, 4);
      const p = svgEl('path', { d, fill: 'none', stroke: t.arrow, 'stroke-width': 2, 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter' }, B.svg);
      await pen.draw(p, s, B.r.x, B.r.y);
      const tip = svgEl('path', { d: tipD(end, dir, 8), fill: t.arrow }, B.svg);
      F.active = { p, tip };
      if (!label) return;
      // la etiqueta va junto a la flecha, del lado libre: nunca encima de una caja ni de otra etiqueta
      const len = p.getTotalLength();
      const wl = label.length * 7.2 + 10, hl = 18;
      const clash = b => F.labels.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
      let spot = null;
      for (const along of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const m = p.getPointAtLength(len * along), q = p.getPointAtLength(Math.min(len, len * along + 1));
        const horizontal = Math.abs(q.x - m.x) >= Math.abs(q.y - m.y);
        for (const side of [-1, 1]) {
          const cx = horizontal ? m.x : m.x + side * (wl / 2 + 6), cy = horizontal ? m.y + side * (hl / 2 + 4) : m.y;
          const b = { x: cx - wl / 2, y: cy - hl / 2, w: wl, h: hl };
          if (!clash(b)) { spot = { cx, cy, b }; break; }
        }
        if (spot) break;
      }
      if (!spot) { const m = p.getPointAtLength(len / 2); spot = { cx: m.x, cy: m.y - 13, b: { x: m.x - wl / 2, y: m.y - 22, w: wl, h: hl } }; }
      F.labels.push(spot.b);
      const e = text(B.svg, spot.cx, spot.cy + 4, label, `font: 500 12px var(--f-mono); fill: var(--ink-muted); paint-order: stroke; stroke: ${t.board}; stroke-width: 6px; stroke-linejoin: round;`);
      e.classList.add('clicky-pop');
    },

    async card({ eyebrow, title, items = [] }, s = 1) {
      const el = sidePanel('clicky-card');
      el.innerHTML = `<div class="eyebrow">${checkSvg(16)}<span>${esc(eyebrow || 'Conclusión')}</span></div><h4>${esc(title || '')}</h4>${items.length ? '<ul></ul>' : ''}`;
      const ul = el.querySelector('ul');
      const lis = items.map(it => htmlEl('li', '', ul, `${checkSvg(16)}<span>${esc(it)}</span>`));
      advance(el);
      await sleep(200 * s);
      for (const li of lis) {
        const r = rectOf(li);
        await pen.travel(r.x - 8, r.y + 11, 0.25 * s);
        li.classList.add('on');
        await sleep(260 * s);
      }
    },

    async note({ text: t }, s = 1) {
      const el = sidePanel('clicky-note');
      el.innerHTML = `<span class="k">Nota</span>${esc(t)}`;
      advance(el);
      await sleep(300 * s);
    },

    async button({ text: t }, s = 1) {
      if (!ctx.actions) { ctx.actions = sidePanel('clicky-actions'); advance(ctx.actions); }
      const b = htmlEl('button', 'clicky-btn clicky-pop', ctx.actions);
      b.type = 'button';
      b.textContent = t;
      b.onclick = () => ctx.onAsk(t);
      await sleep(160 * s);
    },
  };
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
