import { svgEl, htmlEl, rectOf, wobble, toD, smoothD, ellipsePts, linePts, rrectPts, edgePoint, arrowHeadD, sleep, animate, easeOut } from './geometry.js';

// Marks drawn on top of the real screen, anchored to elements by id.
// Each mark is async and takes `s`, a speed factor the director uses to fit the speech.
export function createMarks(ctx) {
  const { layers, pen } = ctx;
  // On dark pages, what is drawn over the screen uses the theme's onDark colors (boards and cards keep theirs).
  const theme = () => { const t = ctx.theme(); return ctx.surface === 'dark' && t.onDark ? { ...t, ...t.onDark } : t; };
  const find = id => (id && document.getElementById(id)) || null;

  function stroke(d, { color, width, layer = layers.marks, opacity, dash } = {}) {
    const t = theme();
    const p = svgEl('path', {
      d, fill: 'none', stroke: color || t.mark, 'stroke-width': width || t.width,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity,
    }, layer);
    if (t.glow && layer === layers.marks) p.setAttribute('filter', 'url(#clicky-glow)');
    ctx.strokes.push({ path: p, dash });
    return p;
  }

  function pill(x, y, text, { up = false } = {}) {
    const el = htmlEl('div', 'clicky-pill clicky-pop' + (up ? ' up' : ''), layers.panels);
    el.textContent = text;
    const maxX = innerWidth - el.offsetWidth - 12;
    el.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
    el.style.top = y + 'px';
    ctx.items.push(el);
    return el;
  }

  function labelNear(b, text) {
    if (!text) return;
    const below = b.y + b.h + 50 < innerHeight;
    pill(b.x - 2, below ? b.y + b.h + 16 : b.y - 44, text, { up: !below });
  }

  return {
    async ring({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), b = rectOf(el);
      await pen.draw(stroke(smoothD(ellipsePts(b, { amp: t.wobble * 1.4 }))), 0.85 * s);
      if (t.wobble > 1.2) await pen.draw(stroke(smoothD(ellipsePts(b, { amp: t.wobble * 2, turns: 0.55, padX: 18, padY: 13 })), { width: t.width * 0.45, opacity: 0.75 }), 0.3 * s);
      labelNear({ ...b, x: b.x - 8, h: b.h + 8 }, label);
      await sleep(180 * s);
    },

    async frame({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), b = rectOf(el, 8);
      const tint = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 12, fill: t.zone, opacity: 0 }, layers.marks);
      ctx.fades.push(tint);
      const p = stroke(toD(rrectPts(b.x, b.y, b.w, b.h, 12, t.wobble)), { color: t.zone, dash: t === ctx.themes.ink ? '9 7' : null });
      await pen.draw(p, 1 * s);
      if (t === ctx.themes.ink) p.style.strokeDasharray = '9 7';
      if (t === ctx.themes.sketch) await pen.draw(stroke(toD(rrectPts(b.x + 3, b.y + 2, b.w - 5, b.h - 4, 14, t.wobble * 1.6)), { color: t.zone, width: 1.4 }), 0.35 * s);
      animate(0.4, u => tint.setAttribute('opacity', 0.08 * u));
      if (label) {
        const side = pill(b.x + b.w + 14, b.y + b.h / 2 - 15, label);
        side.classList.add('side');
        if (b.x + b.w + 14 + side.offsetWidth > innerWidth - 12) { side.classList.remove('side'); side.classList.add('up'); side.style.left = b.x + 14 + 'px'; side.style.top = b.y - 36 + 'px'; }
      }
      await sleep(150 * s);
    },

    async highlight({ target }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), b = rectOf(el);
      const p = stroke(toD(wobble(linePts(b.x - 4, b.y + b.h / 2 + 1, b.x + b.w + 4, b.y + b.h / 2, 24), 0.8)),
        { color: t.highlighter, width: b.h + 4, layer: layers.highlight });
      p.setAttribute('stroke-linecap', 'butt');
      await pen.draw(p, 0.55 * s);
    },

    async underline({ target }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), b = rectOf(el);
      await pen.draw(stroke(toD(wobble(linePts(b.x - 2, b.y + b.h + 3, b.x + b.w + 4, b.y + b.h + 1, 24), 0.9))), 0.45 * s);
      if (t.wobble > 1.2) await pen.draw(stroke(toD(wobble(linePts(b.x + 6, b.y + b.h + 8, b.x + b.w - 2, b.y + b.h + 7, 20), 0.9)), { width: t.width * 0.6 }), 0.25 * s);
    },

    async num({ target, n = 1 }, s = 1) {
      const el = find(target); if (!el) return;
      const b = rectOf(el), inside = getComputedStyle(el).textAlign === 'right' && b.w > 70;
      const x = inside ? b.x + 22 : Math.max(16, b.x - 20);
      await pen.travel(x, b.y + b.h / 2, 0.25 * s);
      const badge = htmlEl('div', 'clicky-badge clicky-pop', layers.panels, String(n));
      badge.style.left = x + 'px';
      badge.style.top = b.y + b.h / 2 + 'px';
      badge.style.setProperty('--origin', 'center');
      ctx.items.push(badge);
      await sleep(260 * s);
    },

    async arrow({ from, to, label }, s = 1) {
      const A = find(from), B = find(to); if (!A || !B) return;
      const t = theme(), a = rectOf(A), b = rectOf(B);
      const [x1, y1] = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2, 10), [x2, y2] = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2, 12);
      const p = stroke(smoothD(wobble(linePts(x1, y1, x2, y2, 30, Math.min(70, Math.hypot(x2 - x1, y2 - y1) * 0.2)), t.wobble * 0.7)), { color: t.arrow });
      await pen.draw(p, 0.8 * s);
      await pen.draw(stroke(arrowHeadD(p, 13), { color: t.arrow }), 0.18 * s);
      if (label) pill(x1 - 10, y1 + 12, label);
    },

    async target({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const b = rectOf(el, 6);
      await pen.travel(b.x + b.w + 6, b.y + b.h - 4, 0.3 * s);
      const ring = htmlEl('div', 'clicky-target clicky-pop', layers.panels);
      Object.assign(ring.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
      ring.style.setProperty('--origin', 'center');
      ctx.items.push(ring);
      labelNear(b, label || 'haz clic aquí');
      await sleep(300 * s);
    },

    async spotlight({ target }, s = 1) {
      const el = find(target); if (!el) return;
      ctx.spotHoles.push(rectOf(el, 4));
      ctx.renderSpotlight();
      await animate(0.4 * s, u => layers.spot.style.opacity = easeOut(u));
    },
  };
}
