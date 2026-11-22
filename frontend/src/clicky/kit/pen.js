import { svgEl, animate, easeInOut, reducedMotion } from './geometry.js';

// El lápiz de Hinty es el blip del radar (DESIGN.md › Hinty › 4): un cuadrado cian de 10×10 que
// viaja hasta cada marca y deja el trazo detrás. No gira: es un pixel.
// Como el compañero de HeyClicky, cuando no está dibujando acompaña al cursor (un poco abajo a la
// derecha, siguiéndolo con suavidad); al explicar vuela recto a cada cosa y después vuelve.
// Trazo a 600 px/s, entre 250 y 700 ms por trazo. `s` es el factor del director para calzar con
// la voz: si hay poco tiempo (s < 1), el trazo se apura; nunca se alarga más allá del máximo.
const PX_PER_S = 600, MIN = 0.25, MAX = 0.7;
const OFFSET = { x: 14, y: 18 }; // junto al cursor, sin taparlo
export const strokeTime = (len, s = 1) => Math.min(MAX, Math.max(MIN, len / PX_PER_S)) * Math.min(1, s);
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

  async function travel(x, y, seconds = 0.35) {
    show();
    moving++;
    try {
      const p0 = { ...pos }, d = Math.hypot(x - p0.x, y - p0.y);
      if (reducedMotion() || p0.x < -50 || d < 4) return place(x, y);
      // recto y sin arco: la torre marca en línea, no a mano alzada
      await animate(Math.min(seconds, 0.12 + d / 2400), u => {
        const t = easeInOut(u);
        place(p0.x + (x - p0.x) * t, p0.y + (y - p0.y) * t);
      });
    } finally {
      moving--;
      wake();
    }
  }

  // Dibuja un path. Si es punteado (data-dash), lo revela con una máscara para que el punteado
  // se vea desde el primer trazo.
  async function draw(path, s = 1, ox = 0, oy = 0) {
    const dash = path.dataset.dash;
    if (dash) path.style.strokeDasharray = dash;
    const len = path.getTotalLength();
    if (reducedMotion()) return; // aparece completa, sin trazo
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
    moving++;
    try {
      await animate(time, u => {
        const e = easeInOut(u);
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

  async function erase(path, seconds, ox = 0, oy = 0) {
    if (!path.isConnected) return;
    if (path.dataset.dash || path.getAttribute('fill') !== 'none') {
      await animate(seconds, u => path.setAttribute('opacity', 1 - u));
      return path.remove();
    }
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len} ${len}`;
    moving++;
    try {
      await animate(seconds, u => {
        path.style.strokeDashoffset = len * u;
        const a = path.getPointAtLength(len * (1 - u));
        place(a.x + ox, a.y + oy);
      });
    } finally {
      moving--;
    }
    path.remove();
    wake();
  }

  return { draw, erase, travel, show, hide, place, cursor: setCursor, follow: setFollow, get following() { return follow; }, get pos() { return pos; } };
}
