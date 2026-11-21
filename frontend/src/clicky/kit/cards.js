import { svgEl, htmlEl, rectOf, wobble, toD, smoothD, linePts, rrectPts, edgePoint, arrowHeadD, sleep, animate } from './geometry.js';

// Panels that live in free space: a board for charts and diagrams, and a side column
// for the summary card, notes and follow-up buttons. The host page marks that space with
// data-clicky-region="board" and data-clicky-region="side".
export function createCards(ctx) {
  const { layers, pen, theme } = ctx;

  function region(name) {
    const el = document.querySelector(`[data-clicky-region="${name}"]`);
    if (el) return rectOf(el);
    return name === 'board'
      ? { x: 40, y: innerHeight * 0.45, w: Math.min(620, innerWidth * 0.5), h: innerHeight * 0.45 }
      : { x: innerWidth - 420, y: 120, w: 380, h: innerHeight - 160 };
  }

  function panel(className, r) {
    const el = htmlEl('div', `clicky-panel ${className} clicky-pop`, layers.panels);
    Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px' });
    if (r.h) el.style.height = r.h + 'px';
    ctx.items.push(el);
    return el;
  }

  function sidePanel(className) {
    const r = region('side');
    const el = panel(className, { x: r.x, y: r.y + ctx.sideY, w: r.w });
    return el;
  }
  const advance = el => { ctx.sideY += el.offsetHeight + 18; };

  function board(title, sub) {
    ctx.board?.classList.add('clicky-out');
    const r = region('board');
    const el = panel('clicky-board', r);
    el.style.setProperty('--origin', 'center');
    const ttl = htmlEl('div', 'ttl', el);
    const [main, ...rest] = (title || '').split(' por ');
    ttl.innerHTML = rest.length ? `${esc(main)} <i>por ${esc(rest.join(' por '))}</i>` : esc(title || '');
    if (sub) htmlEl('div', 'sub', el, esc(sub));
    const svg = svgEl('svg', {}, el);
    ctx.board = el;
    return { el, svg, r, W: r.w, H: r.h };
  }

  function line(svg, d, color, width, extra = {}) {
    return svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra }, svg);
  }
  function text(svg, x, y, t, style, attrs = {}) {
    const e = svgEl('text', { x, y, 'text-anchor': 'middle', ...attrs }, svg, t);
    e.setAttribute('style', style);
    e.classList.add('clicky-pop');
    e.style.setProperty('--origin', 'center');
    e.style.transformBox = 'fill-box';
    return e;
  }
  function hatch(svg, r, color) {
    const id = 'clh' + Math.random().toString(36).slice(2, 8);
    svgEl('clipPath', { id }, svg).appendChild(svgEl('rect', { x: r.x + 2, y: r.y + 2, width: r.w - 4, height: r.h - 4, rx: 5 }));
    const g = svgEl('g', { 'clip-path': `url(#${id})`, opacity: 0 }, svg);
    for (let x = r.x - r.h; x < r.x + r.w; x += 7) line(g, toD(wobble([[x, r.y + r.h], [x + r.h, r.y]], 0.5)), color, 2.4, { opacity: 0.65 });
    return g;
  }

  const hand = 'font-family: var(--f-hand); font-weight: 700;';

  return {
    async chart({ title, subtitle, bars, highlight, note }, s = 1) {
      const t = theme(), B = board(title, subtitle);
      await sleep(250 * s);
      const n = bars.length, x0 = 56, y0 = B.H - 50, plotH = B.H - 150, max = Math.max(...bars.map(b => b.value)) * 1.08;
      const bw = Math.min(64, (B.W - 110) / n * 0.6), gap = (B.W - 110 - n * bw) / Math.max(1, n - 1);
      const valueStyle = t === ctx.themes.platanus ? "font: 15px 'Archivo Black', sans-serif;" : `${hand} font-size: 21px;`;
      const labelStyle = t === ctx.themes.platanus ? 'font: 700 12.5px var(--f-ui);' : `${hand} font-size: 21px;`;
      await pen.draw(line(B.svg, toD(wobble(linePts(x0 - 14, y0, B.W - 40, y0, 30), t.wobble * 0.6)), t.ink, t.width * 0.8), 0.45 * s, B.r.x, B.r.y);
      let hot = null;
      for (let i = 0; i < n; i++) {
        const { label, value } = bars[i], isHot = label === highlight;
        const h = value / max * plotH, x = x0 + i * (bw + gap), y = y0 - h, r = { x, y, w: bw, h };
        const color = isHot ? t.hot : t.palette[i % t.palette.length];
        let fill;
        if (t.hatch) fill = hatch(B.svg, r, isHot ? t.hot : color);
        else fill = svgEl('rect', { x, y, width: bw, height: h, rx: t === ctx.themes.platanus ? 0 : 6, fill: color, opacity: 0 }, B.svg);
        const outline = line(B.svg, t === ctx.themes.platanus ? `M${x},${y0} V${y} H${x + bw} V${y0}` : toD(rrectPts(x, y, bw, h, 6, t.wobble * 0.8)), isHot && t === ctx.themes.ink ? t.hot : t.ink, t.width * 0.72);
        await pen.draw(outline, 0.32 * s, B.r.x, B.r.y);
        animate(0.35, u => fill.setAttribute('opacity', u));
        text(B.svg, x + bw / 2, y - 10, String(value), valueStyle + `fill: ${isHot ? (t === ctx.themes.platanus ? '#111' : t.hot) : '#6b6880'};`);
        text(B.svg, x + bw / 2, y0 + 26, label, labelStyle + `fill: ${t.ink};`);
        if (isHot) hot = r;
      }
      if (hot && note) {
        if (t === ctx.themes.platanus) {
          const tag = htmlEl('div', 'clicky-pop', B.el, esc(note));
          tag.setAttribute('style', `position:absolute;left:${hot.x - 20}px;top:${hot.y - 92}px;padding:6px 12px;font:22px 'Archivo Black',sans-serif;color:#ffd23f;background:#111;--base:rotate(3deg);transform:rotate(3deg);white-space:nowrap`);
        } else {
          const p = line(B.svg, smoothD(wobble(linePts(hot.x - 30, hot.y - 82, hot.x + 2, hot.y - 32, 16, -10), 1)), t.arrow, t.width * 0.85);
          await pen.draw(p, 0.4 * s, B.r.x, B.r.y);
          await pen.draw(line(B.svg, arrowHeadD(p, 11), t.arrow, t.width * 0.85), 0.15 * s, B.r.x, B.r.y);
          text(B.svg, hot.x - 34, hot.y - 92, note, `${hand} font-size: 30px; fill: ${t.hot};`);
        }
      }
      await sleep(200 * s);
    },

    async diagram({ title, nodes, edges = [] }, s = 1) {
      const t = theme(), B = board(title);
      await sleep(250 * s);
      const level = Object.fromEntries(nodes.map(n => [n.id, 0]));
      for (let k = 0; k < nodes.length; k++) for (const [a, b] of edges) if (level[a] != null && level[b] != null) level[b] = Math.max(level[b], Math.min(level[a] + 1, 5));
      const cols = Math.max(...Object.values(level)) + 1, byLevel = {};
      nodes.forEach(n => (byLevel[level[n.id]] ||= []).push(n));
      const W = B.W, top = 84, H = B.H - top - 24, w = Math.min(150, (W - 40 - (cols - 1) * 44) / cols), h = 64, pos = {};
      for (const [lv, list] of Object.entries(byLevel)) {
        const x = cols === 1 ? (W - w) / 2 : 20 + lv * (W - 40 - w) / (cols - 1);
        list.forEach((n, i) => pos[n.id] = { x, y: top + (H - list.length * h - (list.length - 1) * 24) / 2 + i * (h + 24), w, h });
      }
      for (const [i, n] of nodes.entries()) {
        const r = pos[n.id], color = t.palette[i % t.palette.length];
        const fill = t.hatch ? hatch(B.svg, r, color) : svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 12, fill: t === ctx.themes.ink ? '#eef3ff' : '#fff', opacity: 0 }, B.svg);
        await pen.draw(line(B.svg, toD(rrectPts(r.x, r.y, r.w, r.h, 12, t.wobble)), t === ctx.themes.ink ? t.mark : t.ink, t.width * 0.72), 0.42 * s, B.r.x, B.r.y);
        animate(0.3, u => fill.setAttribute('opacity', u));
        const words = n.text.split(' '), lines = [''];
        for (const wd of words) ((lines.at(-1) + ' ' + wd).trim().length > Math.floor(w / 10) && lines.at(-1)) ? lines.push(wd) : lines[lines.length - 1] = (lines.at(-1) + ' ' + wd).trim();
        lines.slice(0, 3).forEach((l, k) => text(B.svg, r.x + r.w / 2, r.y + r.h / 2 + 7 + (k - (lines.length - 1) / 2) * 20, l, (t === ctx.themes.platanus ? 'font: 700 13px var(--f-ui);' : `${hand} font-size: 20px;`) + `fill: ${t.ink};`));
      }
      for (const [a, b, label] of edges) {
        const A = pos[a], Bn = pos[b]; if (!A || !Bn) continue;
        const [x1, y1] = edgePoint(A, Bn.x + Bn.w / 2, Bn.y + Bn.h / 2), [x2, y2] = edgePoint(Bn, A.x + A.w / 2, A.y + A.h / 2);
        const p = line(B.svg, smoothD(wobble(linePts(x1, y1, x2, y2, 20, Math.abs(x2 - x1) > 30 ? 12 : 0), 0.8)), t.arrow, t.width * 0.75);
        await pen.draw(p, 0.35 * s, B.r.x, B.r.y);
        await pen.draw(line(B.svg, arrowHeadD(p, 10), t.arrow, t.width * 0.75), 0.12 * s, B.r.x, B.r.y);
        if (label) { const m = p.getPointAtLength(p.getTotalLength() / 2); text(B.svg, m.x, m.y - 12, label, `${hand} font-size: 18px; fill: ${t.arrow};`); }
      }
    },

    // Pizarra narrada, como HeyClicky arma su dibujo línea a línea: board abre la hoja con su
    // grilla, cada node pone una caja en su celda cuando la voz la nombra y cada edge une dos
    // cajas ya dibujadas. La grilla fija dónde va cada caja aunque las demás no hayan llegado.
    async board({ title, subtitle, cols = 3, rows = 2 }, s = 1) {
      const B = board(title, subtitle);
      ctx.flow = { B, cols, rows, pos: {}, labels: [] };
      await sleep(220 * s);
    },

    async node({ id, text: label, col = 0, row = 0, hot }, s = 1) {
      const F = ctx.flow;
      if (!F) return;
      const t = theme(), { B } = F, top = subtitleOffset(B), padX = 22, padB = 22;
      const cw = (B.W - 2 * padX) / F.cols, ch = (B.H - top - padB) / F.rows;
      // aire entre celdas para las flechas y sus etiquetas
      const w = Math.max(90, Math.min(200, cw - 84)), h = Math.max(52, Math.min(80, ch - 44));
      const r = { x: padX + col * cw + (cw - w) / 2, y: top + row * ch + (ch - h) / 2, w, h };
      F.pos[id] = r;
      const stroke = hot ? t.hot : t === ctx.themes.ink ? t.mark : t.ink;
      const fill = t.hatch ? hatch(B.svg, r, hot ? t.hot : t.palette[0]) : svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 12, fill: hot ? '#ffe9e6' : t === ctx.themes.ink ? '#eef3ff' : '#fff', opacity: 0 }, B.svg);
      await pen.draw(line(B.svg, toD(rrectPts(r.x, r.y, r.w, r.h, 12, t.wobble)), stroke, t.width * 0.72), 0.42 * s, B.r.x, B.r.y);
      animate(0.3 * s, u => fill.setAttribute('opacity', u));
      // el texto se achica hasta caber en la caja (máx 3 líneas)
      let size = 21, lines;
      for (; size >= 14; size -= 1.5) {
        lines = wrap(label, Math.floor((w - 16) / (size * 0.5)));
        if (lines.length <= 3 && lines.length * size * 1.05 <= h - 10) break;
      }
      const style = (t === ctx.themes.platanus ? `font: 700 ${size * 0.68}px var(--f-ui);` : `${hand} font-size: ${size}px;`) + `fill: ${hot ? t.hot : t.ink};`;
      lines.slice(0, 3).forEach((l, k) => text(B.svg, r.x + r.w / 2, r.y + r.h / 2 + size * 0.35 + (k - (lines.length - 1) / 2) * size * 1.05, l, style));
      F.labels.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      await sleep(120 * s);
    },

    async edge({ from, to, label }, s = 1) {
      const F = ctx.flow, A = F?.pos[from], Bn = F?.pos[to];
      if (!A || !Bn) return;
      const t = theme(), { B } = F;
      const [x1, y1] = edgePoint(A, Bn.x + Bn.w / 2, Bn.y + Bn.h / 2), [x2, y2] = edgePoint(Bn, A.x + A.w / 2, A.y + A.h / 2);
      // un poco de curva, hacia arriba en la misma fila
      const bend = Math.abs(y2 - y1) < 8 ? -10 : Math.abs(x2 - x1) < 8 ? 10 : 8;
      const p = line(B.svg, smoothD(wobble(linePts(x1, y1, x2, y2, 20, bend), 0.7)), t.arrow, t.width * 0.75);
      await pen.draw(p, 0.38 * s, B.r.x, B.r.y);
      await pen.draw(line(B.svg, arrowHeadD(p, 10), t.arrow, t.width * 0.75), 0.12 * s, B.r.x, B.r.y);
      if (!label) return;
      // la etiqueta va junto al medio de la flecha, del lado libre: nunca encima de una caja ni de otra etiqueta
      const len = p.getTotalLength(), dx = x2 - x1, dy = y2 - y1, n = Math.hypot(dx, dy) || 1;
      const nx = -dy / n, ny = dx / n;
      const clash = b => F.labels.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
      // si no cabe entera, la letra se achica antes de rendirse
      let spot = null, size = 17;
      for (; size >= 12 && !spot; size -= 1) {
        const wLabel = label.length * size * 0.5 + 6, hLabel = size + 4;
        for (const along of [0.5, 0.38, 0.62, 0.28, 0.72]) {
          const m = p.getPointAtLength(len * along);
          for (const side of [-1, 1]) {
            const off = Math.abs(ny) > 0.5 ? hLabel / 2 + 3 : wLabel / 2 + 6;
            const cx = m.x + nx * off * side, cy = m.y + ny * off * side;
            const b = { x: cx - wLabel / 2, y: cy - hLabel / 2, w: wLabel, h: hLabel };
            if (!clash(b)) { spot = { cx, cy, b, size }; break; }
          }
          if (spot) break;
        }
      }
      if (!spot) { const m = p.getPointAtLength(len / 2), wl = label.length * 6 + 6; spot = { cx: m.x, cy: m.y - 12, b: { x: m.x - wl / 2, y: m.y - 20, w: wl, h: 16 }, size: 12 }; }
      size = spot.size;
      F.labels.push(spot.b);
      const e = text(B.svg, spot.cx, spot.cy + size * 0.35, label, `${hand} font-size: ${size}px; fill: ${t.arrow}; paint-order: stroke; stroke: #fff; stroke-width: 5px; stroke-linejoin: round;`);
      e.setAttribute('stroke', '#fff');
    },

    async card({ eyebrow, title, items = [] }, s = 1) {
      const el = sidePanel('clicky-card');
      el.innerHTML = `${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}<h4>${esc(title || '')}</h4><ul></ul>`;
      const ul = el.querySelector('ul'), lis = items.map((it, i) => htmlEl('li', '', ul, `<b>${theme() === ctx.themes.platanus ? '0' + (i + 1) : '✓'}</b><span>${esc(it)}</span>`));
      advance(el);
      await sleep(260 * s);
      for (const li of lis) {
        const r = rectOf(li);
        await pen.travel(r.x - 6, r.y + r.h / 2, 0.25 * s);
        li.classList.add('on');
        await sleep(330 * s);
      }
    },

    async note({ text: t }, s = 1) {
      const el = sidePanel('clicky-note');
      el.style.width = 'auto';
      el.style.maxWidth = region('side').w + 'px';
      el.textContent = t;
      advance(el);
      await sleep(400 * s);
    },

    async button({ text: t }, s = 1) {
      if (!ctx.actions) { ctx.actions = sidePanel('clicky-actions'); advance(ctx.actions); }
      const b = htmlEl('button', 'clicky-btn clicky-pop' + (ctx.actions.children.length ? '' : ' primary'), ctx.actions);
      b.textContent = t;
      b.onclick = () => ctx.onAsk(t);
      await sleep(180 * s);
    },
  };
}

// Parte un texto en líneas de hasta `max` caracteres, sin cortar palabras.
function wrap(text, max) {
  const lines = [''];
  for (const word of String(text).split(/\s+/)) {
    const next = (lines.at(-1) + ' ' + word).trim();
    if (next.length > max && lines.at(-1)) lines.push(word);
    else lines[lines.length - 1] = next;
  }
  return lines;
}
// Dónde empieza el área de dibujo de la pizarra: bajo el título y el subtítulo.
function subtitleOffset(B) {
  const head = B.el.querySelector('.sub') || B.el.querySelector('.ttl');
  return head ? Math.max(64, head.offsetTop + head.offsetHeight + 18) : 64;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
