import { svgEl, htmlEl, rectOf, sleep, animate, tipD } from './geometry.js';
import { planLayout, cellRect, route, roundedPath, endDir, segmentBoxes, placeLabel, freeSpot } from './flow.js';
import { headsetSvg, checkSvg } from './icons.js';

// Paneles en espacio libre (DESIGN.md › Hinty › 6, 7 y 11): la pizarra (board/node/edge y chart)
// y una columna para la card de conclusión, las notas y los botones de la siguiente pregunta.
// La página marca ese espacio con data-clicky-region:
//   "stage"      → donde va la pizarra (en /simulate, la ventana de Chrome), centrada, máx 720×560.
//   "stage-side" → la columna de tarjetas (320 px pegada al borde derecho de Chrome).
//   "board" / "side" → regiones antiguas, de respaldo.
// Ninguna región cae sobre el panel del Agente.
// el alto es un tope: la pizarra se ajusta a su diagrama (y crece si llega un ejemplo)
const BOARD_MAX = { w: 720, h: 560 }, GAP = 16, GRID = 24;
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

  // En una pantalla angosta la columna de tarjetas se achica (hasta 220 px) para que la pizarra tenga
  // ancho de verdad: con 320 px fijos quedaba de ~380 px y las cajas no cabían.
  function regions() {
    const stage = belowIsland(regionRect('stage'));
    const side = belowIsland(regionRect('stage-side'));
    if (!stage || !side || side.x <= stage.x) return { stage, side };
    const free = side.x - stage.x - GAP;
    if (free >= 520) return { stage, side };
    const w = Math.round(Math.max(220, Math.min(side.w, stage.w * 0.3)));
    return { stage, side: { ...side, x: side.x + side.w - w, w } };
  }

  // Tan angosta que ni achicando la columna cabe una pizarra útil (< 600 px): la pizarra toma todo el
  // ancho y las tarjetas van debajo de ella (o encima, a la derecha, si no queda alto).
  const STACK_BELOW = 600;

  function sideRegion() {
    const { stage, side } = regions();
    if (stage && stage.w < STACK_BELOW) {
      // bajo la pizarra que está dibujada (se ajusta a su dibujo, así que puede ser más baja que su región)
      const b = ctx.board?.isConnected ? rectOf(ctx.board) : boardRegion(), y = b.y + b.h + GAP, h = stage.y + stage.h - y - GAP;
      if (h >= 160) return { x: stage.x + GAP, y, w: Math.min(360, stage.w - 2 * GAP), h };
    }
    return side || belowIsland(regionRect('side')) || { x: innerWidth - 360, y: 120, w: 320, h: innerHeight - 160 };
  }

  function boardRegion() {
    const { stage, side } = regions();
    if (stage) {
      const narrow = stage.w < STACK_BELOW;
      // centrada en lo que deja libre la columna de tarjetas, para que no se tapen entre sí
      const free = !narrow && side && side.x > stage.x ? { ...stage, w: side.x - stage.x - GAP } : stage;
      const w = Math.min(BOARD_MAX.w, free.w - 2 * GAP), h = Math.min(BOARD_MAX.h, free.h - 2 * GAP);
      if (w >= 300 && h >= 220) return { x: Math.round(free.x + (free.w - w) / 2), y: Math.round(narrow ? free.y + GAP : free.y + (free.h - h) / 2), w, h };
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

  // La pizarra es una ventana, como las tarjetas de HeyClicky: barra con el auricular de Hinty y
  // "PIZARRA", el título grande con su bajada en gris y la hoja con una grilla apenas visible.
  function board(title, sub) {
    ctx.board?.classList.add('clicky-out');
    const r = boardRegion();
    const el = panel('clicky-board', r);
    el.innerHTML = `<div class="bar">${headsetSvg(16)}<span>Pizarra</span></div><div class="hd"><div class="ttl">${esc(title || '')}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
    const svg = svgEl('svg', {}, el);
    ctx.board = el;
    const hd = el.querySelector('.hd');
    const top = hd.offsetTop + hd.offsetHeight + 8;
    return { el, svg, r: { ...r }, W: r.w, H: r.h, top, region: r };
  }

  // Como la ventana de HeyClicky crece a lo que tiene dibujado, la pizarra queda del alto de su
  // diagrama (sin una franja vacía arriba y abajo) y centrada donde iba.
  function shrinkBoard(B, want) {
    want = Math.ceil(want);
    if (want >= B.H - 16) return false;
    const { stage } = regions();
    B.H = want;
    B.r.h = want;
    if (!(stage && stage.w < STACK_BELOW)) B.r.y = Math.round(B.region.y + (B.region.h - want) / 2);
    Object.assign(B.el.style, { height: want + 'px', top: B.r.y + 'px' });
    return true;
  }
  function fitBoard(B, L) {
    const gridH = L.r * L.h + (L.r - 1) * L.gy;
    if (!shrinkBoard(B, L.top + gridH + Math.max(32, L.gy / 2 + 12))) return L;
    return planLayout({ W: B.W, H: B.H, top: B.top }, L.transposed ? L.r : L.c, L.transposed ? L.c : L.r);
  }

  async function growWithExample(F, html, s) {
    const { B, L } = F;
    const gridW = L.c * L.w + (L.c - 1) * L.gx, gridBottom = L.y0 + L.r * L.h + (L.r - 1) * L.gy;
    const linesBottom = F.lines.reduce((m, b) => Math.max(m, b.y + b.h), 0);
    const y = Math.ceil(Math.max(gridBottom + 18, linesBottom + 10));
    const w = Math.min(gridW, 460);
    const el = htmlEl('div', 'clicky-example on-board below clicky-pop', B.el, html);
    Object.assign(el.style, { width: w + 'px', left: Math.round(L.x0 + (gridW - w) / 2) + 'px', top: y + 'px' });
    const want = y + el.offsetHeight + 22;
    if (want > B.region.h) { el.remove(); return false; }
    if (want > B.H) {
      const { stage } = regions();
      B.H = want;
      B.r.h = want;
      if (!(stage && stage.w < STACK_BELOW)) B.r.y = Math.round(B.region.y + (B.region.h - want) / 2);
      Object.assign(B.el.style, { height: want + 'px', top: B.r.y + 'px' });
      await sleep(260);
    }
    await pen.travel(B.r.x + parseFloat(el.style.left) + 12, B.r.y + y + 12);
    await sleep(500 * s);
    return true;
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
      list.style.top = B.top + 8 + 'px';
      // la ventana del alto de sus barras (fila de 22 px y 14 de aire entre filas)
      shrinkBoard(B, B.top + 8 + bars.length * 22 + (bars.length - 1) * 14 + 28);
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
        pen.travel(r.x + r.w * pct, r.y + r.h / 2, grow, { exact: true });
        await animate(grow, u => (bar.style.width = `${pct * 100 * u}%`));
        await sleep(60 * s);
      }
      await sleep(120 * s);
    },

    // Pizarra narrada: board abre la hoja con su grilla, cada node pone una caja en su celda cuando la
    // voz la nombra y cada edge une dos cajas ya dibujadas. La geometría (flow.js) reparte la hoja para
    // que las cajas nunca se toquen y las flechas viajen por los pasillos. Como HeyClicky, cada pieza se
    // construye a la vista: el lápiz traza el borde, el relleno aparece un instante después y el texto al
    // final; una flecha es primero el trazo y después la punta, y su etiqueta llega cuando la punta está.
    async board({ title, subtitle, cols = 3, rows = 2 }, s = 1) {
      const B = board(title, subtitle);
      const L = fitBoard(B, planLayout({ W: B.W, H: B.H, top: B.top }, cols, rows));
      const under = svgEl('g', { class: 'clicky-flow-lines' }, B.svg), over = svgEl('g', { class: 'clicky-flow-boxes' }, B.svg);
      ctx.flow = { B, L, under, over, pos: {}, occupied: new Set(), used: {}, labels: [], lines: [], active: null };
      await sleep(200 * s);
    },

    async node({ id, text: label, col = 0, row = 0, tone, hot }, s = 1) {
      const F = ctx.flow;
      if (!F) return;
      const { B, L } = F, t = theme();
      const R = { ...cellRect(L, col, row), id };
      F.pos[id] = R;
      F.occupied.add(`${R.c},${R.r}`);
      const kind = NODE_KINDS.includes(tone) ? tone : hot ? 'key' : 'plain';
      const st = nodeStyle(kind, t);
      const fill = svgEl('rect', { x: R.x, y: R.y, width: R.w, height: R.h, rx: 10, fill: st.fill, opacity: 0 }, F.over);
      const edge = svgEl('path', { d: boxPath(R, 10), fill: 'none', stroke: st.stroke, 'stroke-width': st.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `clicky-box ${kind}` }, F.over);
      if (st.dash) edge.dataset.dash = st.dash;
      // el relleno aparece en 0,35 s, 0,18 s después de que el lápiz empieza el borde (como HeyClicky)
      await pen.draw(edge, s, B.r.x, B.r.y, { onStart: () => sleep(180).then(() => animate(0.35, u => fill.setAttribute('opacity', u))) });
      // las cajas con color dicen qué son (ataque, defensa, la idea clave) en una línea chica arriba,
      // así el color se lee sin leyenda; si la caja es baja, el color basta
      const tag = TAGS[kind] && R.h >= 60 ? `<i class="tag">${TAGS[kind]}</i>` : '';
      const el = htmlEl('div', `clicky-node ${kind}`, B.el, `${tag}<span>${esc(label)}</span>`);
      Object.assign(el.style, { left: R.x + 'px', top: R.y + 'px', width: R.w + 'px', height: R.h + 'px' });
      // el texto se achica antes de cortarse: se mide sin cortar palabras ni límite de líneas, y solo si
      // ni el tamaño más chico alcanza se deja partir palabras con guion (y se suelta la línea del tono)
      el.classList.add('measuring');
      if (R.w < 132) el.classList.add('narrow');
      const words = el.querySelector('span'), tagEl = el.querySelector('.tag');
      // alto real del contenido (centrado en una caja flex, lo que sobra no aparece en scrollHeight)
      const fits = () => {
        const cs = getComputedStyle(el), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const tagH = tagEl && getComputedStyle(tagEl).display !== 'none' ? tagEl.offsetHeight + 3 : 0;
        return words.offsetHeight + tagH + padY <= R.h + 1 && words.scrollWidth <= words.clientWidth + 1;
      };
      let ok = false;
      for (const size of ['', 'small', 'tiny', 'notag']) {
        if (size) el.classList.add(size);
        if ((ok = fits())) break;
      }
      if (!ok) el.classList.add('hyph');
      el.classList.remove('measuring');
      await sleep(160 * Math.min(1, s));
    },

    async edge({ from, to, label, tone }, s = 1) {
      const F = ctx.flow, A = F?.pos[from], Bn = F?.pos[to];
      if (!A || !Bn) return;
      const t = theme(), { B, L } = F, attack = tone === 'attack';
      // la flecha que se está explicando va en cian; la anterior pasa a line-strong
      if (F.active) {
        F.active.p.setAttribute('stroke', t.line);
        F.active.tip.setAttribute('fill', t.line);
        F.active = null;
      }
      const pts = route(L, A, Bn, F.used, F.labels);
      const color = attack ? t.attack : t.arrow;
      const p = svgEl('path', { d: roundedPath(pts, 8), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, F.under);
      if (attack) p.dataset.dash = '6 6';
      await pen.draw(p, s, B.r.x, B.r.y);
      // la punta, después del trazo
      const end = pts[pts.length - 1];
      const tip = svgEl('path', { d: tipD({ x: end[0], y: end[1] }, endDir(pts), 9), fill: color, class: 'clicky-tip' }, F.under);
      if (!attack) F.active = { p, tip };
      F.lines.push(...segmentBoxes(pts, 3));
      if (!label) return sleep(120 * s);
      const e = text(B.svg, 0, 0, label, `font: 500 13px var(--f-ui); letter-spacing: .01em; fill: ${attack ? 'var(--attack-strong)' : 'var(--ink-muted)'}; paint-order: stroke; stroke: ${t.board}; stroke-width: 6px; stroke-linejoin: round;`);
      e.setAttribute('opacity', 0);
      let w = label.length * 7;
      try { w = e.getBBox().width || w; } catch { /* sin layout todavía */ }
      const boxes = Object.values(F.pos).map(r => ({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }));
      const spot = placeLabel(pts, { w: w + 10, h: 19 }, {
        obstacles: [...boxes, ...F.labels, ...F.lines],
        bounds: { x: 4, y: B.top - 8, w: B.W - 8, h: B.H - B.top + 4 },
      });
      F.labels.push(spot);
      e.setAttribute('x', spot.x + spot.w / 2);
      e.setAttribute('y', spot.y + 14);
      animate(0.3, u => e.setAttribute('opacity', u));
      await sleep(180 * s);
    },

    // Un ejemplo de la vida diaria ("Es como…"): un papelito en un espacio libre de la pizarra, o en la
    // columna de tarjetas si la pizarra no tiene lugar (o no hay pizarra).
    async example({ text: t }, s = 1) {
      const F = ctx.flow, html = `<span class="k">Ejemplo</span><p>${esc(t)}</p>`;
      if (F) {
        const spot = freeSpot(F.L, F.occupied, F.lines.concat(F.labels), { minW: 150, minH: 56 });
        if (spot) {
          const el = htmlEl('div', 'clicky-example on-board clicky-pop', F.B.el, html);
          const w = Math.min(spot.w, 300);
          Object.assign(el.style, { width: w + 'px', left: spot.x + (spot.w - w) / 2 + 'px', top: spot.y + 'px' });
          if (el.offsetHeight <= spot.h + 8) {
            el.style.top = spot.y + Math.max(0, (spot.h - el.offsetHeight) / 2) + 'px';
            await pen.travel(F.B.r.x + parseFloat(el.style.left) + 12, F.B.r.y + parseFloat(el.style.top) + 12, 0.3 * s);
            await sleep(500 * s);
            return;
          }
          el.remove();
        }
        // sin una celda libre, la pizarra crece hacia abajo para llevarlo bajo el diagrama, como la
        // ventana de HeyClicky crece a lo que se dibuja en ella
        if (await growWithExample(F, html, s)) return;
      }
      const el = sidePanel('clicky-example');
      el.innerHTML = html;
      advance(el);
      await sleep(500 * s);
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

// Estilo de cada caja según lo que significa (DESIGN.md › Hinty: cian para lo de Hinty, ámbar
// punteado solo para lo del atacante).
const NODE_KINDS = ['key', 'defense', 'attack'];
const TAGS = { key: 'Idea clave', defense: 'Defensa', attack: 'Ataque' };
// Como las cajas de HeyClicky (rellenas de su color, con el borde del mismo tono más intenso), en la
// paleta de Mayday: la clave llena de cian profundo, la defensa con un velo cian, el ataque con un velo
// ámbar y su borde punteado; un paso neutro, una hoja apenas más clara que la pizarra.
function nodeStyle(kind, t) {
  switch (kind) {
    case 'key': return { stroke: t.hot, fill: '#0A3540', width: 2 };
    case 'defense': return { stroke: t.mark, fill: '#2EE6FF17', width: 1.5 };
    case 'attack': return { stroke: t.attack, fill: '#FF8A0019', width: 2, dash: '7 5' };
    default: return { stroke: t.line, fill: '#13222B', width: 1.5 };
  }
}

// El borde de una caja como un solo trazo: arranca arriba a la izquierda y da la vuelta completa.
function boxPath({ x, y, w, h }, r) {
  return `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
