import { svgEl, htmlEl, rectOf, sleep, animate, easeOut, rectD, elbow, tipD } from './geometry.js';

// Marcas sobre la pantalla real, ancladas a elementos por id (DESIGN.md › Hinty › 5).
// Todas cian, rectas y de 3 px: una torre de control marcando un radar. Cada marca es async y
// recibe `s`, el factor de velocidad con que el director la calza con la voz.
// Lo del atacante: si el elemento es rastro del ataque, ring/frame/arrow van en ámbar punteado
// (nunca relleno) y siempre con una etiqueta cian que lo explique.
const ATTACK = '.md-evidence, [data-attack], .md-log--attack, .bg-attack-soft, .text-attack, .text-attack-strong, .is-compromised';
const DASH = '6 6';

export function createMarks(ctx) {
  const { layers, pen } = ctx;
  const theme = () => ctx.theme();
  const find = id => (id && document.getElementById(id)) || null;
  const isAttack = el => !!el.closest(ATTACK);

  function stroke(d, { color, width, layer = layers.marks, opacity, dash } = {}) {
    const t = theme();
    const p = svgEl('path', {
      d, fill: 'none', stroke: color || t.mark, 'stroke-width': width || t.width,
      'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', opacity,
    }, layer);
    if (dash) p.dataset.dash = dash;
    ctx.strokes.push({ path: p, dash });
    return p;
  }

  function solid(d, color) {
    const p = svgEl('path', { d, fill: color, opacity: 0 }, layers.marks);
    ctx.strokes.push({ path: p });
    animate(0.12, u => p.setAttribute('opacity', u));
    return p;
  }

  // Las etiquetas no salen de la columna principal (si la página la marca): nunca caen sobre el Agente.
  function bounds() {
    const col = document.querySelector('[data-clicky-region="column"]');
    const r = col && col.getClientRects().length ? rectOf(col) : null;
    return r ? { left: r.x, right: r.x + r.w } : { left: 0, right: innerWidth };
  }

  function pill(x, y, text, { up = false } = {}) {
    const el = htmlEl('div', 'clicky-pill clicky-pop' + (up ? ' up' : ''), layers.panels);
    el.textContent = text;
    const { left, right } = bounds();
    el.style.left = Math.max(left + 8, Math.min(x, right - el.offsetWidth - 8)) + 'px';
    el.style.top = y + 'px';
    ctx.items.push(el);
    return el;
  }

  function labelNear(b, text) {
    if (!text) return;
    const below = b.y + b.h + 44 < innerHeight;
    pill(b.x, below ? b.y + b.h + 8 : b.y - 32, text, { up: !below });
  }

  function labelSide(b, text) {
    const side = pill(b.x + b.w + 10, b.y + b.h / 2 - 12, text);
    side.classList.add('side');
    if (b.x + b.w + 10 + side.offsetWidth > bounds().right - 8) {
      side.classList.remove('side');
      side.classList.add('up');
      side.style.left = Math.max(bounds().left + 8, b.x) + 'px';
      side.style.top = b.y - 32 + 'px';
    }
  }

  const ATTACK_LABEL = 'Rastro del atacante';

  return {
    async ring({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), attack = isAttack(el), b = rectOf(el, 6);
      await pen.draw(stroke(rectD(b, 4), attack ? { color: t.attack, dash: DASH } : {}), s);
      labelNear(b, label || (attack ? ATTACK_LABEL : ''));
      await sleep(120 * s);
    },

    async frame({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), attack = isAttack(el), b = rectOf(el, 8);
      if (!attack) {
        const tint = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, fill: t.zone, opacity: 0 }, layers.marks);
        ctx.fades.push(tint);
        animate(0.2, u => tint.setAttribute('opacity', t.zoneOpacity * u));
      }
      await pen.draw(stroke(rectD(b, 8), { color: attack ? t.attack : t.zone, width: 2, dash: DASH }), s);
      const text = label || (attack ? ATTACK_LABEL : '');
      if (text) labelSide(b, text);
      await sleep(120 * s);
    },

    async highlight({ target }, s = 1) {
      const el = find(target); if (!el) return;
      const t = theme(), b = rectOf(el);
      const y = b.y + b.h / 2;
      await pen.draw(stroke(`M${b.x - 4},${y} H${b.x + b.w + 4}`, { color: t.highlighter, width: b.h + 4, layer: layers.highlight }), s);
    },

    async underline({ target }, s = 1) {
      const el = find(target); if (!el) return;
      const b = rectOf(el), y = b.y + b.h + 4;
      await pen.draw(stroke(`M${b.x},${y} H${b.x + b.w}`), s);
    },

    async num({ target, n = 1 }, s = 1) {
      const el = find(target); if (!el) return;
      const b = rectOf(el), inside = getComputedStyle(el).textAlign === 'right' && b.w > 70;
      const x = inside ? b.x + 20 : Math.max(16, b.x - 18);
      await pen.travel(x, b.y + b.h / 2, 0.25 * s);
      const badge = htmlEl('div', 'clicky-badge clicky-pop', layers.panels, String(n));
      badge.style.left = x + 'px';
      badge.style.top = b.y + b.h / 2 + 'px';
      ctx.items.push(badge);
      await sleep(200 * s);
    },

    async arrow({ from, to, label }, s = 1) {
      const A = find(from), B = find(to); if (!A || !B) return;
      const t = theme(), attack = isAttack(B), color = attack ? t.attack : t.arrow;
      const a = rectOf(A), b = rectOf(B);
      const { d, end, dir } = elbow(a, b, 8);
      const p = stroke(d, { color, dash: attack ? DASH : null });
      await pen.draw(p, s);
      solid(tipD(end, dir, 10), color);
      const text = label || (attack ? ATTACK_LABEL : '');
      if (text) { const st = p.getPointAtLength(0); pill(st.x - 8, st.y + 10, text); }
    },

    async target({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      const b = rectOf(el, 6);
      await pen.travel(b.x + b.w, b.y + b.h, 0.3 * s);
      const lock = htmlEl('div', 'clicky-target clicky-pop', layers.panels, '<span class="lock"><i></i><i></i><i></i><i></i></span>');
      Object.assign(lock.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
      ctx.items.push(lock);
      labelNear(b, label || 'Haz clic aquí');
      await sleep(240 * s);
    },

    async spotlight({ target }, s = 1) {
      const el = find(target); if (!el) return;
      ctx.spotHoles.push(rectOf(el, 6));
      ctx.renderSpotlight();
      await animate(0.3 * s, u => (layers.spot.style.opacity = easeOut(u)));
    },
  };
}
