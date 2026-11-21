import { svgEl, animate, easeInOut } from './geometry.js';

export function createPen(svg, getTheme) {
  const g = svgEl('g', { class: 'clicky-pen' }, svg);
  const tri = svgEl('polygon', { points: '0,-10 9,8 -9,8' }, g);
  let pos = { x: -100, y: -100 }, angle = -35;

  function paint() {
    const t = getTheme();
    tri.setAttribute('fill', t.pen);
    g.style.filter = t.glow ? `drop-shadow(0 0 7px ${t.glow})` : 'drop-shadow(0 2px 3px rgba(0,0,0,.25))';
  }
  function place(x, y, a = angle) {
    pos = { x, y }; angle = a;
    g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${a.toFixed(1)})`);
  }
  function show() { paint(); g.classList.add('on'); }
  function hide() { g.classList.remove('on'); }

  async function travel(x, y, seconds = 0.35) {
    show();
    const p0 = { ...pos }, d = Math.hypot(x - p0.x, y - p0.y);
    if (p0.x < -50 || d < 4) return place(x, y);
    const c = { x: (p0.x + x) / 2, y: (p0.y + y) / 2 - Math.min(d * 0.2, 60) };
    await animate(Math.min(seconds, 0.15 + d / 1800), u => {
      const t = easeInOut(u), o = 1 - t;
      const px = o * o * p0.x + 2 * o * t * c.x + t * t * x, py = o * o * p0.y + 2 * o * t * c.y + t * t * y;
      const tx = 2 * o * (c.x - p0.x) + 2 * t * (x - c.x), ty = 2 * o * (c.y - p0.y) + 2 * t * (y - c.y);
      place(px, py, Math.atan2(ty, tx) * 180 / Math.PI + 90);
    });
  }

  async function draw(path, seconds, ox = 0, oy = 0) {
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len} ${len}`;
    path.style.strokeDashoffset = len;
    const start = path.getPointAtLength(0);
    await travel(start.x + ox, start.y + oy);
    await animate(seconds, u => {
      const e = easeInOut(u);
      path.style.strokeDashoffset = len * (1 - e);
      const a = path.getPointAtLength(len * e), b = path.getPointAtLength(Math.min(len, len * e + 1.5));
      place(a.x + ox, a.y + oy, Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90);
    });
    path.style.strokeDasharray = '';
  }

  async function erase(path, seconds, ox = 0, oy = 0) {
    if (!path.isConnected) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len} ${len}`;
    await animate(seconds, u => {
      path.style.strokeDashoffset = len * u;
      const a = path.getPointAtLength(len * (1 - u));
      place(a.x + ox, a.y + oy, -35);
    });
    path.remove();
  }

  return { draw, erase, travel, show, hide, place, get pos() { return pos; } };
}
