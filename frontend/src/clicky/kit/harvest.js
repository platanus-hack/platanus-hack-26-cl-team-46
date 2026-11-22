// Qué hay en la pantalla y dónde, como el AnnotationAccessibilityHarvester de HeyClicky, pero con
// el DOM (que en nuestra propia app es exacto): todo lo que se puede apretar, escribir o leer, con su
// caja en pixeles. Cada elemento recibe un alias corto (e1, e2…) que el modelo usa para marcar, y el
// mismo número va dibujado en la captura, así lo que ve y lo que nombra son lo mismo.

const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=menuitem], [role=checkbox], [role=switch], [role=option], [contenteditable=""], [contenteditable=true]';
const KINDS = { H1: 'título', H2: 'título', H3: 'subtítulo', H4: 'subtítulo', H5: 'subtítulo', H6: 'subtítulo', BUTTON: 'botón', A: 'enlace', INPUT: 'campo', SELECT: 'selector', TEXTAREA: 'campo de texto', SUMMARY: 'desplegable', TABLE: 'tabla', PRE: 'código', CODE: 'código', IMG: 'imagen', LI: 'ítem', TD: 'celda', TH: 'encabezado', TR: 'fila', LABEL: 'etiqueta' };
// Lo del atacante (mismo criterio que las marcas): el modelo lo sabe y lo marca en ámbar.
export const ATTACK = '.md-evidence, [data-attack], .md-log--attack, .bg-attack-soft, .text-attack, .text-attack-strong, .is-compromised';
const MAX = 180;

// Lo que saca de la simulación: un enlace a otra página de la app (o a otra pestaña, a otro sitio,
// a un correo o a una descarga), o lo que la página marcó con data-clicky-exit (botones que navegan
// por código, como "Crear otro sandbox"). Hinty lo puede señalar, pero nunca lo aprieta.
// Un enlace a otra parte de esta misma página (#…) no saca a nadie.
export function leavesSimulation(el) {
  if (!el?.closest) return false;
  if (el.closest('[data-clicky-exit]')) return true;
  const a = el.closest('a[href], area[href]');
  if (!a) return false;
  if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return true;
  return leavesTo(a.getAttribute('href'));
}
// Ir de `from` (por defecto, aquí) a esta dirección saca de la simulación: otro sitio, otra página u
// otra búsqueda (#… no).
export function leavesTo(href, from = location.href) {
  try {
    const here = new URL(from), u = new URL(href, here);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    return u.origin !== here.origin || u.pathname !== here.pathname || u.search !== here.search;
  } catch { return true; }
}

// Campos de clave o secretos: Hinty nunca escribe ahí y su valor no sale de la página.
const SECRET = /(pass|secret|token|api[-_ ]?key|clave|contrase|credencial|private)/i;
export const isSecretField = el => !!el && (el.type === 'password' || SECRET.test([el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute?.('aria-label')].join(' ')));

// Lo que se ve de verdad: la caja recortada por cada panel con scroll u overflow oculto que la
// contiene (un mensaje que quedó arriba en un chat con scroll no se ve, aunque esté en la ventana).
// `cache` guarda el recorte de cada contenedor durante una cosecha.
export function visibleBox(el, cache = new Map()) {
  const r = el.getBoundingClientRect();
  let x1 = Math.max(0, r.left), y1 = Math.max(0, r.top), x2 = Math.min(innerWidth, r.right), y2 = Math.min(innerHeight, r.bottom);
  for (let p = el.parentElement; p && p !== document.body && x2 > x1 && y2 > y1; p = p.parentElement) {
    let clip = cache.get(p);
    if (clip === undefined) {
      const cs = getComputedStyle(p);
      clip = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' ? p.getBoundingClientRect() : null;
      cache.set(p, clip);
    }
    if (clip) { x1 = Math.max(x1, clip.left); y1 = Math.max(y1, clip.top); x2 = Math.min(x2, clip.right); y2 = Math.min(y2, clip.bottom); }
  }
  return { r, x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}
// Fracción visible de un elemento (0 a 1).
export function shownFraction(el, cache) {
  const v = visibleBox(el, cache);
  return v.r.width * v.r.height > 0 ? (v.w * v.h) / (v.r.width * v.r.height) : 0;
}

const clean = s => String(s || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
let clips = new Map(); // recortes de la cosecha en curso
const visible = (el, r) => {
  if (r.width < 3 || r.height < 3 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) <= 0.05) return false;
  // al menos la mitad a la vista (o 12 px de alto, para bloques largos que asoman)
  const v = visibleBox(el, clips);
  return v.w * v.h >= 0.5 * r.width * r.height || (v.h >= 12 && v.w >= 24);
};
const ownText = el => {
  let t = '';
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
  return t.trim();
};
function label(el) {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const lab = el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || '';
    const val = isSecretField(el) ? (el.value ? '••••' : '') : el.value; // un secreto no va al modelo
    return clean([lab, val && `valor: ${val}`].filter(Boolean).join(' · '));
  }
  if (el.tagName === 'SELECT') return clean((el.getAttribute('aria-label') || '') + ' ' + (el.selectedOptions?.[0]?.text || ''));
  return clean(el.getAttribute('aria-label') || el.innerText || el.alt || el.title || '');
}

// { list: [{ id, kind, text, box: [x,y,w,h], attack?, disabled?, exit? }], map: Map(id → element) }
export function harvestScreen({ skip = () => false } = {}) {
  clips = new Map();
  const picked = new Set(), out = [];
  const add = (el, kind, r) => {
    if (picked.has(el) || out.length >= MAX * 2) return;
    picked.add(el);
    out.push({ el, kind, r });
  };
  const all = document.body.querySelectorAll('*');
  for (const el of all) {
    if (el.closest('.clicky-root') || skip(el)) continue;
    const tag = el.tagName;
    // localName: en SVG el tagName va en minúsculas ("svg", "path"), así que no se compara con tagName
    const name = el.localName;
    if (name === 'script' || name === 'style' || name === 'svg' || name === 'path' || name === 'noscript') continue;
    const tagged = el.hasAttribute('data-clicky') && !el.hasAttribute('data-clicky-auto');
    const interactive = el.matches(INTERACTIVE);
    const heading = /^H[1-6]$/.test(tag);
    // lo que va dentro de un botón o enlace ya lo cubre el botón
    if (!interactive && !tagged && el.parentElement?.closest(INTERACTIVE)) continue;
    const text = !interactive && !heading && ownText(el);
    if (!(tagged || interactive || heading || text || tag === 'IMG' || tag === 'TABLE' || tag === 'PRE' || el.getAttribute('role') === 'row')) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    // un bloque gigante con un poco de texto suelto no es un "elemento": se lo salta
    if (text && r.width * r.height > innerWidth * innerHeight * 0.35) continue;
    const kind = (tagged && el.dataset.clicky) || el.getAttribute('role') || KINDS[tag] || (text ? 'texto' : 'elemento');
    add(el, kind, r);
  }
  // Filas: un contenedor bajo con 2+ piezas de texto suelto (hora · nivel · mensaje de un log, o
  // autor · hora · mensaje de un chat) también se puede marcar entero, como "esta línea". Una barra
  // de botones o un formulario no es una fila.
  const byParent = new Map();
  for (const o of out) {
    if (o.kind !== 'texto') continue;
    for (let p = o.el.parentElement, up = 0; p && up < 2 && p !== document.body; p = p.parentElement, up++) {
      if (picked.has(p)) break;
      byParent.set(p, (byParent.get(p) || 0) + 1);
    }
  }
  for (const [p, n] of byParent) {
    if (n < 2 || n > 8) continue;
    if (p.querySelectorAll(INTERACTIVE).length > 1 || [...byParent.keys()].some(q => q !== p && p.contains(q) && byParent.get(q) === n)) continue;
    const r = p.getBoundingClientRect();
    if (r.height > 64 || r.width > innerWidth * 0.9 || !visible(p, r)) continue;
    add(p, 'fila', r);
  }
  // orden de lectura: de arriba abajo y de izquierda a derecha (con tolerancia de media línea)
  out.sort((a, b) => (Math.abs(a.r.top - b.r.top) < 8 ? a.r.left - b.r.left : a.r.top - b.r.top));
  // prioridad si sobran: lo marcado por la página, lo que se aprieta, títulos, filas y después textos
  const rank = o => (o.el.hasAttribute('data-clicky') && !o.el.hasAttribute('data-clicky-auto') ? 0 : o.el.matches(INTERACTIVE) ? 1 : /^H[1-6]$/.test(o.el.tagName) ? 2 : o.kind === 'fila' ? 3 : 4);
  const keep = new Set([...out].sort((a, b) => rank(a) - rank(b)).slice(0, MAX));
  const map = new Map(), list = [];
  for (const o of out) {
    if (!keep.has(o)) continue;
    const id = 'e' + (list.length + 1);
    const big = o.el.tagName === 'TABLE' || o.el.tagName === 'PRE';
    const text = (o.el.matches(INTERACTIVE) || /^H[1-6]$/.test(o.el.tagName) || o.kind === 'fila' ? label(o.el) : clean(o.el.innerText || o.el.alt || '')).slice(0, big ? 1200 : 160);
    if (!text && o.el.tagName !== 'IMG' && !o.el.matches(INTERACTIVE)) continue;
    map.set(id, o.el);
    const v = visibleBox(o.el, clips); // la parte que se ve, que es la que está en la captura
    const item = { id, kind: o.kind, text, box: [v.x, v.y, v.w, v.h].map(Math.round) };
    if (o.el.closest(ATTACK)) item.attack = true;
    if (o.el.disabled || o.el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (leavesSimulation(o.el)) item.exit = true;
    list.push(item);
  }
  return { list, map };
}

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Caja de unas palabras exactas dentro de un elemento (o de toda la página): así el círculo cae
// sobre "JWT_SECRET" y no sobre toda la fila, como HeyClicky ancla sus marcas al texto que lee.
export function textRect(text, within = document.body) {
  const want = fold(String(text || '').trim());
  if (want.length < 2 || !within) return null;
  const nodes = [], walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && !n.parentElement?.closest('.clicky-root,script,style') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let all = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ n, at: all.length }); all += n.nodeValue; }
  const hay = fold(all);
  let from = 0;
  for (let i = hay.indexOf(want, from); i >= 0; i = hay.indexOf(want, from)) {
    from = i + 1;
    const range = document.createRange();
    const locate = pos => { let k = nodes.length - 1; while (k > 0 && nodes[k].at > pos) k--; return [nodes[k].n, pos - nodes[k].at]; };
    const [sn, so] = locate(i), [en, eo] = locate(i + want.length - 1);
    try { range.setStart(sn, so); range.setEnd(en, Math.min(en.nodeValue.length, eo + 1)); } catch { continue; }
    const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    const r = rects[0]; // la primera línea: un círculo sobre dos líneas se lee peor
    if (r.bottom <= 0 || r.top >= innerHeight) continue;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return null;
}

// Caja del texto mismo (no la del bloque): un párrafo que ocupa todo el ancho pero dice cuatro
// palabras se marca en esas cuatro palabras. null si no es texto (campos, botones, imágenes).
export function tightRect(el) {
  if (!el || el.matches?.('input, textarea, select, button, img, svg, canvas, video')) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let x = Infinity, y = Infinity, R = -Infinity, B = -Infinity;
  for (let n = walker.nextNode(), k = 0; n && k < 200; n = walker.nextNode(), k++) {
    if (!n.nodeValue.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      x = Math.min(x, r.left); y = Math.min(y, r.top); R = Math.max(R, r.right); B = Math.max(B, r.bottom);
    }
  }
  return R > x ? { x, y, w: R - x, h: B - y } : null;
}

// La captura con el número de cada elemento (set-of-marks): el modelo ve "7" sobre el botón y lo
// nombra "e7". Recuadro fino solo en lo que se aprieta; en lo demás, solo el número.
export async function labelShot(dataUrl, list, map) {
  if (!dataUrl || !list.length) return dataUrl;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const k = c.width / innerWidth;
  g.font = `600 ${Math.max(9, Math.round(10 * k))}px ui-monospace, Menlo, monospace`;
  g.textBaseline = 'top';
  const taken = [];
  for (const it of list) {
    const el = map.get(it.id);
    // número solo en lo que se aprieta, títulos, filas y lo del atacante: los textos sueltos se
    // ubican por su texto y su caja, y tantas etiquetas taparían lo que hay que leer
    if (!it.box || !(el?.matches?.(INTERACTIVE) || it.attack || it.kind === 'fila' || /título/.test(it.kind) || (el?.hasAttribute('data-clicky') && !el.hasAttribute('data-clicky-auto')))) continue;
    const [x, y, w, h] = it.box.map(v => v * k);
    if (el?.matches?.(INTERACTIVE)) { g.strokeStyle = 'rgba(255, 43, 214, .75)'; g.lineWidth = Math.max(1, k); g.strokeRect(x + .5, y + .5, w - 1, h - 1); }
    const tag = it.id.slice(1), tw = g.measureText(tag).width + 4 * k, th = 12 * k;
    let tx = Math.max(0, x - 1), ty = Math.max(0, y - th);
    // si choca con otra etiqueta, va dentro de la caja, abajo a la derecha
    if (taken.some(t => tx < t.x + t.w && tx + tw > t.x && ty < t.y + t.h && ty + th > t.y)) { tx = Math.min(c.width - tw, x + w - tw); ty = Math.min(c.height - th, y + h - th); }
    taken.push({ x: tx, y: ty, w: tw, h: th });
    g.fillStyle = 'rgba(255, 43, 214, .92)';
    g.fillRect(tx, ty, tw, th);
    g.fillStyle = '#fff';
    g.fillText(tag, tx + 2 * k, ty + 1.5 * k);
  }
  return c.toDataURL('image/jpeg', 0.78);
}
