import { svgEl, animate, easeInOut, easeStroke, reducedMotion } from './geometry.js';

// El lápiz de Hinty es el blip del radar (DESIGN.md › Hinty › 4): un cuadrado cian de 10×10 que
// viaja hasta cada marca y deja el trazo detrás. No gira: es un pixel.
// Como el compañero de HeyClicky, cuando no está dibujando acompaña al cursor (un poco abajo a la
// derecha, siguiéndolo con suavidad); al explicar vuela recto a cada cosa y después vuelve.
// Tiempos de HeyClicky: cada trazo dura 0,25 s + 1 s por cada 1400 px (entre 0,3 y 1,4 s), con su
// curva (arranque decidido, frenado suave). `s` es el ritmo del director para calzar con la voz: lo
// estira o lo apura, pero nunca baja de 0,35 (un trazo que no se alcanza a ver no explica nada).
// Entre trazos el lápiz vuela: un salto corto (< 110 px) se desliza recto; uno largo levanta en un
// arco suave, entre 0,2 y 0,55 s, y la tinta espera a que aterrice.
const OFFSET = { x: 14, y: 18 }; // junto al cursor, sin taparlo
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const strokeTime = (len, s = 1) => clamp(0.25 + len / 1400, 0.3, 1.4) * Math.max(s, 0.35);
export const flightTime = d => Math.min(0.55, 0.2 + d / 2400);
const HOP = 110;
let maskSeq = 0;

export function createPen(svg, { onStroke } = {}) {
  const g = svgEl('g', { class: 'clicky-pen' }, svg);
  svgEl('rect', { x: -5, y: -5, width: 10, height: 10, class: 'blip' }, g);
  let pos = { x: -100, y: -100 }, follow = false, cursor = null, raf = 0, moving = 0;

  function place(x, y) {
    pos = { x, y };
    g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
  }
  function show() { g.classList.add('on'); }
  function hide() { g.classList.remove('on'); }

  // Seguir al cursor: se acerca un 25 % por cuadro (sin rebote) y se detiene al llegar.
  function chase() {
    raf = 0;
    if (!follow || moving || !cursor) return;
    const tx = cursor.x + OFFSET.x, ty = cursor.y + OFFSET.y;
    if (reducedMotion() || pos.x < -50) return place(tx, ty);
    const k = 0.25, nx = pos.x + (tx - pos.x) * k, ny = pos.y + (ty - pos.y) * k;
    place(nx, ny);
    if (Math.hypot(tx - nx, ty - ny) > 0.6) raf = requestAnimationFrame(chase);
    else place(tx, ty);
  }
  const wake = () => { if (!raf && follow && !moving) raf = requestAnimationFrame(chase); };
  function setCursor(x, y) { cursor = { x, y }; if (follow) show(); wake(); }
  function setFollow(on) {
    follow = on;
    if (on) { if (cursor) show(); wake(); }
  }

  let flown = false; // el primer vuelo de una explicación es más pausado (0,45 s): el ojo lo sigue
  // `exact`: dura justo `seconds` (para acompañar algo que crece, como una barra). Si no, el vuelo
  // lo decide la distancia, como en HeyClicky, y `seconds` se ignora.
  async function travel(x, y, seconds, { exact = false } = {}) {
    show();
    moving++;
    try {
      const p0 = { ...pos }, d = Math.hypot(x - p0.x, y - p0.y);
      if (reducedMotion() || p0.x < -50 || d < 4) return place(x, y);
      if (d < HOP) {
        await animate(exact ? seconds : 0.12 + d / 2400, u => {
          const t = easeInOut(u);
          place(p0.x + (x - p0.x) * t, p0.y + (y - p0.y) * t);
        });
        return;
      }
      const time = exact ? seconds : flown ? flightTime(d) : 0.45;
      flown = true;
      // arco suave hacia arriba (la normal que apunta al cielo), proporcional al salto
      let nx = -(y - p0.y) / d, ny = (x - p0.x) / d;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const lift = Math.min(48, d * 0.12);
      await animate(time, u => {
        const t = easeInOut(u), k = Math.sin(Math.PI * t) * lift;
        place(p0.x + (x - p0.x) * t + nx * k, p0.y + (y - p0.y) * t + ny * k);
      });
    } finally {
      moving--;
      wake();
    }
  }
  const rest = () => { flown = false; };

  // Dibuja un path. Si es punteado (data-dash), lo revela con una máscara para que el punteado
  // se vea desde el primer trazo.
  async function draw(path, s = 1, ox = 0, oy = 0, { onStart } = {}) {
    const dash = path.dataset.dash;
    if (dash) path.style.strokeDasharray = dash;
    const len = path.getTotalLength();
    if (reducedMotion()) return void onStart?.(0); // aparece completa, sin trazo
    let reveal = path, mask = null;
    if (dash) {
      const owner = path.ownerSVGElement;
      const defs = owner.querySelector(':scope > defs') || svgEl('defs', {}, owner);
      const id = 'hinty-mask-' + ++maskSeq;
      mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: -10000, y: -10000, width: 30000, height: 30000 }, defs);
      reveal = svgEl('path', { d: path.getAttribute('d'), fill: 'none', stroke: '#fff', 'stroke-width': (Number(path.getAttribute('stroke-width')) || 3) + 6 }, mask);
      path.setAttribute('mask', `url(#${id})`);
    }
    reveal.style.strokeDasharray = `${len} ${len}`;
    reveal.style.strokeDashoffset = len;
    const start = path.getPointAtLength(0);
    await travel(start.x + ox, start.y + oy);
    const time = strokeTime(len, s);
    onStroke?.(time);
    onStart?.(time);
    moving++;
    try {
      await animate(time, u => {
        const e = easeStroke(u);
        reveal.style.strokeDashoffset = len * (1 - e);
        const a = path.getPointAtLength(len * e);
        place(a.x + ox, a.y + oy);
      });
    } finally {
      moving--;
    }
    if (mask) { path.removeAttribute('mask'); mask.remove(); }
    else path.style.strokeDasharray = '';
    wake();
  }

  // Borra un trazo corriendo el lápiz hacia atrás. Varios borrados pueden ir encimados (HeyClicky borra
  // en cascada): el lápiz acompaña solo al último que empezó.
  let eraseSeq = 0;
  async function erase(path, seconds, ox = 0, oy = 0) {
    if (!path.isConnected) return;
    const mine = ++eraseSeq;
    if (path.dataset.dash || path.getAttribute('fill') !== 'none') {
      await animate(seconds, u => path.setAttribute('opacity', 1 - u));
      return path.remove();
    }
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len} ${len}`;
    moving++;
    try {
      await animate(seconds, u => {
        const e = easeStroke(u);
        path.style.strokeDashoffset = len * e;
        if (mine !== eraseSeq) return;
        const a = path.getPointAtLength(len * (1 - e));
        place(a.x + ox, a.y + oy);
      });
    } finally {
      moving--;
    }
    path.remove();
    wake();
  }

  return { draw, erase, travel, rest, show, hide, place, cursor: setCursor, follow: setFollow, get following() { return follow; }, get pos() { return pos; } };
}
