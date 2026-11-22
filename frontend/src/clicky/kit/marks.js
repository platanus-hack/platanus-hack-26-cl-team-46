import { svgEl, htmlEl, rectOf, sleep, animate, easeOut, easeStroke, reducedMotion, rectD, elbow, tipD } from './geometry.js';
import { checkSvg } from './icons.js';
import { ATTACK, textRect, tightRect } from './harvest.js';

// Marcas sobre la pantalla real (DESIGN.md › Hinty › 5). Todas cian, rectas y de 3 px: una torre de
// control marcando un radar. Cada marca es async y recibe `s`, el factor de velocidad con que el
// director la calza con la voz.
// - Se anclan a un elemento (alias e1, e2… de harvest.js) y, con `text`, a esas palabras exactas
//   dentro de él: el círculo cae sobre "JWT_SECRET", no sobre toda la fila.
// - Siguen al elemento si la página hace scroll (cada marca vive en su propio grupo, ver anchor).
// - Lo del atacante (por la página o con tone "attack") va en ámbar punteado, nunca relleno, y
//   siempre con una etiqueta cian que lo explique.
const DASH = '6 6';
const ATTACK_LABEL = 'Rastro del atacante';

export function createMarks(ctx) {
  const { layers, pen } = ctx;
  const theme = () => ctx.theme();
  const sound = () => ctx.sound || {};
  const find = id => { const el = ctx.find(id); return el && el.isConnected ? el : null; };
  const isAttack = (el, tone) => tone === 'attack' || !!el.closest(ATTACK);

  // Un grupo por marca, en cada capa: si la página hace scroll, se mueve entero con su elemento.
  function anchor(el) {
    const a = {
      el, base: rectOf(el), dx: 0, dy: 0,
      g: svgEl('g', {}, layers.marks),
      gh: svgEl('g', {}, layers.highlight),
      div: htmlEl('div', 'clicky-anchor', layers.panels),
    };
    ctx.anchors.push(a);
    return a;
  }
  ctx.anchor = anchor;

  // La caja a marcar: las palabras exactas (dentro del elemento o, si el modelo eligió uno vecino,
  // en su fila) o, con `tight`, el texto mismo y no el bloque que lo contiene.
  function boxOf(el, text, pad = 0, { tight = false } = {}) {
    let r = null;
    if (text) for (let p = el, up = 0; p && up < 3 && !r; p = p.parentElement, up++) r = textRect(text, p);
    if (!r && tight) r = tightRect(el);
    return r ? { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 } : rectOf(el, pad);
  }

  function stroke(d, A, { color, width, layer, opacity, dash } = {}) {
    const t = theme();
    const p = svgEl('path', {
      d, fill: 'none', stroke: color || t.mark, 'stroke-width': width || t.width,
      'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', opacity,
    }, layer || A.g);
    if (dash) p.dataset.dash = dash;
    ctx.strokes.push({ path: p, dash, anchor: A });
    return p;
  }

  function solid(d, color, A) {
    const p = svgEl('path', { d, fill: color, opacity: 0 }, A.g);
    ctx.strokes.push({ path: p, anchor: A });
    animate(0.12, u => p.setAttribute('opacity', u));
    return p;
  }

  // Las etiquetas no salen de la columna principal (si la página la marca): nunca caen sobre el Agente.
  function bounds() {
    const col = document.querySelector('[data-clicky-region="column"]');
    const r = col && col.getClientRects().length ? rectOf(col) : null;
    return r ? { left: r.x, right: r.x + r.w } : { left: 0, right: innerWidth };
  }

  function pill(x, y, text, A, { up = false } = {}) {
    const el = htmlEl('div', 'clicky-pill clicky-pop' + (up ? ' up' : ''), A.div);
    el.textContent = text;
    const { left, right } = bounds();
    el.style.left = Math.max(left + 8, Math.min(x, right - el.offsetWidth - 8)) + 'px';
    el.style.top = Math.max(4, Math.min(innerHeight - 28, y)) + 'px';
    ctx.items.push(el);
    sound().pop?.();
    return el;
  }

  // ¿Esa caja ya está ocupada? Textos y controles de otros elementos (no los que contienen al que
  // se marca) y las etiquetas que ya están puestas: así una flecha o una etiqueta no tapa lo que
  // hay que leer al lado.
  const area = (a, r) => (r ? Math.max(0, Math.min(a.x + a.w, r.x + r.w) - Math.max(a.x, r.x)) * Math.max(0, Math.min(a.y + a.h, r.y + r.h) - Math.max(a.y, r.y)) : 0);
  // Cuánto taparía esa caja (en px²): una etiqueta de Hinty o la isla pesan el triple que un texto.
  function cost(box, el) {
    if (box.x < 0 || box.y < 0 || box.x + box.w > innerWidth || box.y + box.h > innerHeight) return Infinity;
    let c = 0;
    for (const it of [...ctx.items, layers.panels.parentElement?.querySelector('.clicky-island')]) {
      const r = it?.getBoundingClientRect();
      if (r?.width) c += 3 * area(box, { x: r.left, y: r.top, w: r.width, h: r.height });
    }
    for (const o of ctx.elements?.() || []) {
      if (!o.isConnected || o === el || o.contains(el) || el.contains(o)) continue;
      c += area(box, o.matches('input, textarea, select, button, img') ? rectOf(o) : tightRect(o));
    }
    return c;
  }
  const taken = (box, el) => cost(box, el) > 0;

  function labelNear(b, text, A, el) {
    if (!text) return;
    const w = text.length * 7.5 + 18;
    const fits = y => y > 4 && y + 28 < innerHeight;
    const spots = [b.y + b.h + 8, b.y - 32].filter(fits);
    const y = spots.find(y => !el || !taken({ x: b.x, y, w, h: 24 }, el)) ?? spots[0] ?? b.y + b.h + 8;
    return pill(b.x, y, text, A, { up: y < b.y });
  }

  function labelSide(b, text, A) {
    const side = pill(b.x + b.w + 10, b.y + b.h / 2 - 12, text, A);
    side.classList.add('side');
    if (b.x + b.w + 10 + side.offsetWidth > bounds().right - 8) {
      side.classList.remove('side');
      side.classList.add('up');
      side.style.left = Math.max(bounds().left + 8, b.x) + 'px';
      side.style.top = Math.max(4, b.y - 32) + 'px';
    }
    return side;
  }

  // Un cuadro de 24 px junto al elemento (check, "?"): a la derecha si cabe, si no a la izquierda.
  function tile(b, cls, html, A) {
    const { left, right } = bounds();
    const x = b.x + b.w + 10 + 24 <= right - 4 ? b.x + b.w + 10 : Math.max(left + 4, b.x - 34);
    const y = b.y + b.h / 2 - 12;
    const el = htmlEl('div', `${cls} clicky-pop`, A.div, html);
    Object.assign(el.style, { left: x + 'px', top: y + 'px' });
    ctx.items.push(el);
    return { el, x, y };
  }

  return {
    // Vuela hasta el elemento y lo señala desde el lado libre con una línea corta y su punta,
    // como el compañero de HeyClicky apuntando a lo que nombra. La etiqueta queda junto al blip.
    async point({ target, text, label, tone }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), A = anchor(el), b = boxOf(el, text, 2, { tight: true }), { left, right } = bounds();
      const attack = isAttack(el, tone), color = attack ? t.attack : t.arrow;
      const cy = b.y + b.h / 2, cx = Math.min(b.x + 40, b.x + b.w / 2), L = 26;
      const words = label || (attack ? ATTACK_LABEL : '');
      const pw = words ? words.length * 7.5 + 22 : 0;
      // El lado libre: a la derecha, a la izquierda, abajo o arriba, el primero que no tape nada.
      const sides = [
        { dir: 'left', from: { x: b.x + b.w + L + 8, y: cy }, to: { x: b.x + b.w + 6, y: cy }, box: { x: b.x + b.w + 4, y: cy - 12, w: L + 16 + pw, h: 24 } },
        { dir: 'right', from: { x: b.x - L - 8, y: cy }, to: { x: b.x - 6, y: cy }, box: { x: b.x - L - 20 - pw, y: cy - 12, w: L + 16 + pw, h: 24 } },
        { dir: 'up', from: { x: cx, y: b.y + b.h + L + 8 }, to: { x: cx, y: b.y + b.h + 6 }, box: { x: cx - 10, y: b.y + b.h + 4, w: Math.max(24, pw), h: L + 40 } },
        { dir: 'down', from: { x: cx, y: b.y - L - 8 }, to: { x: cx, y: b.y - 6 }, box: { x: cx - 10, y: b.y - L - 44, w: Math.max(24, pw), h: L + 40 } },
      ];
      const inCol = o => o.box.x >= left && o.box.x + o.box.w <= right;
      // el primero que no tape nada o, si todos tapan algo, el que tape menos
      let side = sides[2], best = Infinity;
      for (const o of sides) {
        const c = inCol(o) ? cost(o.box, el) : Infinity;
        if (c < best) { best = c; side = o; }
        if (c === 0) break;
      }
      const { from, to, dir } = side;
      await pen.travel(from.x, from.y, 0.45 * s);
      const p = stroke(`M${from.x},${from.y} L${to.x},${to.y}`, A, { color, dash: attack ? DASH : null });
      await pen.draw(p, s);
      solid(tipD(to, dir, 9), color, A);
      sound().flick?.();
      await pen.travel(from.x, from.y, 0.15);
      if (words) {
        const tag = pill(0, 0, words, A);
        const x = dir === 'left' ? from.x + 12 : dir === 'right' ? from.x - 12 - tag.offsetWidth : from.x - 10;
        const y = dir === 'up' ? from.y + 10 : dir === 'down' ? from.y - 34 : from.y - 12;
        tag.style.left = Math.max(left + 8, Math.min(x, right - tag.offsetWidth - 8)) + 'px';
        tag.style.top = Math.max(4, Math.min(innerHeight - 28, y)) + 'px';
      }
      await sleep(160 * s);
    },

    async ring({ target, text, label, tone }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), A = anchor(el), attack = isAttack(el, tone), b = boxOf(el, text, 6);
      await pen.draw(stroke(rectD(b, 4), A, attack ? { color: t.attack, dash: DASH } : {}), s);
      const tag = labelNear(b, label || (attack ? ATTACK_LABEL : ''), A, el);
      await sleep(120 * s);
      return { A, b, tag };
    },

    async frame({ target, label, tone }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), A = anchor(el), attack = isAttack(el, tone), b = rectOf(el, 8);
      // Se abre como una selección (el marquee de HeyClicky): el lápiz arrastra la esquina de abajo a la
      // derecha desde la de arriba a la izquierda en 0,55 s, y el tinte crece con el marco.
      const tint = attack ? null : svgEl('rect', { x: b.x, y: b.y, width: 0, height: 0, rx: 8, fill: t.zone, opacity: t.zoneOpacity }, A.g);
      if (tint) ctx.fades.push(tint);
      const p = stroke(rectD({ ...b, w: 1, h: 1 }, 1), A, { color: attack ? t.attack : t.zone, width: 2 });
      p.style.strokeDasharray = p.dataset.dash = DASH;
      const size = e => {
        const w = Math.max(1, b.w * e), h = Math.max(1, b.h * e);
        p.setAttribute('d', rectD({ x: b.x, y: b.y, w, h }, Math.min(8, w / 2, h / 2)));
        tint?.setAttribute('width', w); tint?.setAttribute('height', h);
        return { w, h };
      };
      if (reducedMotion()) size(1);
      else {
        await pen.travel(A.dx + b.x, A.dy + b.y);
        await animate(0.55 * Math.max(Math.min(s, 1.4), 0.35), u => {
          const { w, h } = size(easeStroke(u));
          pen.place(A.dx + b.x + w, A.dy + b.y + h);
        });
      }
      const words = label || (attack ? ATTACK_LABEL : '');
      if (words) labelSide(b, words, A);
      await sleep(120 * s);
    },

    async highlight({ target, text }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), A = anchor(el), b = boxOf(el, text, 0, { tight: true });
      const y = b.y + b.h / 2;
      await pen.draw(stroke(`M${b.x - 4},${y} H${b.x + b.w + 4}`, A, { color: t.highlighter, width: b.h + 4, layer: A.gh }), s);
    },

    async underline({ target, text, tone }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), A = anchor(el), attack = isAttack(el, tone), b = boxOf(el, text, 0, { tight: true }), y = b.y + b.h + 4;
      await pen.draw(stroke(`M${b.x},${y} H${b.x + b.w}`, A, attack ? { color: t.attack, dash: DASH } : {}), s);
    },

    // Zigzag recto bajo lo que preocupa: dientes de 8 px, sin curvas.
    async scribble({ target, text, label, tone }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), A = anchor(el), attack = isAttack(el, tone), b = boxOf(el, text, 0, { tight: true });
      const y = b.y + b.h + 4, w = Math.max(24, b.w), n = Math.max(3, Math.round(w / 8));
      let d = `M${b.x},${y}`;
      for (let i = 1; i <= n; i++) d += ` L${(b.x + (w * i) / n).toFixed(1)},${i % 2 ? y + 6 : y}`;
      await pen.draw(stroke(d, A, attack ? { color: t.attack, dash: DASH } : {}), s);
      if (label || attack) labelNear({ ...b, h: b.h + 10 }, label || ATTACK_LABEL, A);
      await sleep(100 * s);
    },

    // Tacha: una X recta sobre algo compacto; sobre una fila larga, una línea que la cruza.
    async cross({ target, label, tone }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), A = anchor(el), attack = isAttack(el, tone), b = boxOf(el, null, 3, { tight: true });
      const opts = attack ? { color: t.attack, dash: DASH } : {};
      if (b.w > 5 * b.h) {
        const y = b.y + b.h / 2;
        await pen.draw(stroke(`M${b.x - 4},${y} H${b.x + b.w + 4}`, A, opts), s);
      } else {
        await pen.draw(stroke(`M${b.x},${b.y} L${b.x + b.w},${b.y + b.h}`, A, opts), s * 0.8);
        await pen.draw(stroke(`M${b.x + b.w},${b.y} L${b.x},${b.y + b.h}`, A, opts), s * 0.8);
      }
      if (label || attack) labelNear(b, label || ATTACK_LABEL, A);
      await sleep(100 * s);
    },

    // Check de pixeles junto a lo que está bien.
    async check({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const A = anchor(el), b = boxOf(el, null, 2, { tight: true });
      const spot = tile(b, 'clicky-tick', checkSvg(16), A);
      await pen.travel(spot.x + 12, spot.y + 12, 0.3 * s);
      sound().pop?.();
      if (label) pill(spot.x + 30, spot.y, label, A);
      await sleep(200 * s);
    },

    // "?" en Geist Mono junto a lo que no se sabe.
    async question({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const A = anchor(el), b = boxOf(el, null, 2, { tight: true });
      const spot = tile(b, 'clicky-q', '?', A);
      await pen.travel(spot.x + 12, spot.y + 12, 0.3 * s);
      sound().pop?.();
      if (label) pill(spot.x + 30, spot.y, label, A);
      await sleep(200 * s);
    },

    async num({ target, n = 1 }, s = 1) {
      const el = find(target); if (!el) return;
      const A = anchor(el), b = rectOf(el), inside = getComputedStyle(el).textAlign === 'right' && b.w > 70;
      const x = inside ? b.x + 20 : Math.max(16, b.x - 18);
      await pen.travel(x, b.y + b.h / 2, 0.25 * s);
      const badge = htmlEl('div', 'clicky-badge clicky-pop', A.div, String(n));
      badge.style.left = x + 'px';
      badge.style.top = b.y + b.h / 2 + 'px';
      ctx.items.push(badge);
      sound().pop?.();
      await sleep(200 * s);
    },

    async arrow({ from, to, label, tone }, s = 1) {
      const From = find(from), To = find(to); if (!From || !To) return;
      const t = theme(), A = anchor(To), attack = isAttack(To, tone), color = attack ? t.attack : t.arrow;
      const a = rectOf(From), b = rectOf(To);
      const { d, end, dir } = elbow(a, b, 8);
      const p = stroke(d, A, { color, dash: attack ? DASH : null });
      await pen.draw(p, s);
      solid(tipD(end, dir, 10), color, A);
      sound().flick?.();
      const words = label || (attack ? ATTACK_LABEL : '');
      if (words) { const st = p.getPointAtLength(0); pill(st.x - 8, st.y + 10, words, A); }
    },

    async target({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const A = anchor(el), b = rectOf(el, 6);
      await pen.travel(b.x + b.w, b.y + b.h, 0.3 * s);
      const lock = htmlEl('div', 'clicky-target clicky-pop', A.div, '<span class="lock"><i></i><i></i><i></i><i></i></span>');
      Object.assign(lock.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
      ctx.items.push(lock);
      sound().ping?.();
      labelNear(b, label || 'Haz clic aquí', A);
      await sleep(240 * s);
    },

    async spotlight({ target }, s = 1) {
      const el = find(target); if (!el) return;
      ctx.spotHoles.push({ el, pad: 6 });
      ctx.renderSpotlight();
      await animate(0.3 * s, u => (layers.spot.style.opacity = easeOut(u)));
    },
  };
}
