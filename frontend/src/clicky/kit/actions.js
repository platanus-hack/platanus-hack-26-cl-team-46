import { htmlEl, rectOf, sleep, animate, reducedMotion } from './geometry.js';
import { leavesSimulation, leavesTo, isSecretField } from './harvest.js';

export { isSecretField };

// Hinty usa la página por el usuario, como el computer use de HeyClicky: vuela al control, lo
// aprieta, escribe o hace scroll de verdad. Y guía paso a paso: marca el control que toca
// apretar ahora (step) y espera a que el usuario lo haga.
// Límites que no se negocian:
// - Lo irreversible (borrar, terminar, rotar, enviar…) se confirma antes con un chip Sí / No.
// - Lo que escribe queda como borrador: nunca envía un formulario.
// - Nunca escribe en un campo de clave ni de secretos.
// - Nunca saca al usuario de la simulación: no aprieta enlaces a otra página, pestaña o sitio, ni
//   lo marcado con data-clicky-exit; y si un clic igual intenta cambiar la página, lo bloquea.
// - Cada acción recibe la señal de su respuesta (`signal`): si el usuario pregunta otra cosa,
//   aprieta Esc o cierra los dibujos, la acción se retira antes del clic o de la siguiente letra.
const RISKY = /(\btermina(r)?\b|\belimina(r)?\b|\bborra(r)?\b|\breinicia(r)?\b|\brota(r)?\b|\brevoca(r)?\b|\benv[ií]a(r)?\b|\bdesplega(r)?\b|\bdespliega\b|\bpublica(r)?\b|\bdetene(r)?\b|\bdet[eé]n\b|\bapaga(r)?\b|cerrar sesi|\bpaga(r)?\b|\bconfirma(r)?\b|\bacepta(r)?\b|\bdelete\b|\bremove\b|\bkill\b|\bstop\b|\bsend\b|\bsubmit\b|\breset\b|\brotate\b|\brevoke\b|\bdeploy\b|log ?out|sign out|\bpay\b)/i;
const FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), textarea, [contenteditable=""], [contenteditable=true]';

const textOf = el => String(el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const same = (a, b) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
export function isRisky(el, label = '') {
  if (RISKY.test(textOf(el) + ' ' + label)) return true;
  if (el.type === 'submit' || (el.tagName === 'BUTTON' && el.form && el.type !== 'button')) return true; // envía un formulario
  return false;
}

const onScreen = r => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
async function reveal(el) {
  if (onScreen(el.getBoundingClientRect())) return;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  await sleep(reducedMotion() ? 60 : 420);
}

// Escribe como lo haría React: el setter nativo del valor y un evento input por cada letra.
function setValue(el, v) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// El cerco de los clics vale para toda la página: window.open se reemplaza con el primero que se abre
// y se devuelve con el último que se cierra, aunque dos cercos se crucen.
let fences = 0, realOpen = null;
function openFence() { if (fences++ === 0) { realOpen = window.open; window.open = () => null; } }
function closeFence() { if (--fences === 0) { window.open = realOpen; realOpen = null; } }

export function createActions(ctx, { onStep } = {}) {
  const { layers, pen } = ctx;
  const sound = () => ctx.sound || {};
  const find = id => { const el = ctx.find(id); return el && el.isConnected ? el : null; };

  function note(b, text, cls = '') {
    const el = htmlEl('div', 'clicky-pill clicky-pop ' + cls, layers.panels);
    el.textContent = text;
    el.style.left = Math.max(8, Math.min(b.x, innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = (b.y + b.h + 44 < innerHeight ? b.y + b.h + 8 : Math.max(4, b.y - 32)) + 'px';
    ctx.items.push(el);
    sound().pop?.();
    return el;
  }

  // Pulso del clic: un cuadrado cian que se abre 10 px y se apaga en 300 ms.
  function pulse(b) {
    const el = htmlEl('div', 'clicky-pulse', layers.panels);
    Object.assign(el.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
    animate(reducedMotion() ? 0.01 : 0.3, u => { el.style.outlineOffset = `${2 + u * 10}px`; el.style.opacity = String(1 - u); }).then(() => el.remove());
  }

  // "¿Lo hago?" junto al control, con el texto real del control (no lo que dijo el modelo; eso va
  // abajo, chico, si dice otra cosa). Se resuelve con Sí, No, Esc, si se corta la respuesta o a los 20 s (no).
  function confirm(el, what, said = '', signal) {
    const b = rectOf(el, 6);
    const chip = htmlEl('div', 'clicky-confirm clicky-pop', layers.panels,
      `<span class="k">¿Lo hago?</span><span class="tx"><span class="t"></span></span><button type="button" class="yes">Sí, hazlo</button><button type="button" class="no">No</button>`);
    chip.querySelector('.t').textContent = what;
    if (said && !same(said, what)) htmlEl('span', 'd', chip.querySelector('.tx')).textContent = said;
    const below = b.y + b.h + 64 < innerHeight;
    chip.style.left = Math.max(8, Math.min(b.x, innerWidth - chip.offsetWidth - 8)) + 'px';
    chip.style.top = (below ? b.y + b.h + 8 : Math.max(4, b.y - chip.offsetHeight - 8)) + 'px';
    ctx.items.push(chip);
    sound().ping?.();
    return new Promise(resolve => {
      const done = ok => { clearTimeout(timer); removeEventListener('keydown', esc, true); signal?.removeEventListener('abort', cut); chip.classList.add('clicky-out'); setTimeout(() => chip.remove(), 160); resolve(ok); };
      const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      const cut = () => done(false);
      const timer = setTimeout(() => done(false), 20_000);
      addEventListener('keydown', esc, true);
      signal?.addEventListener('abort', cut, { once: true });
      chip.querySelector('.yes').onclick = () => done(true);
      chip.querySelector('.no').onclick = () => done(false);
      ctx.cancelConfirm = () => done(false);
      if (signal?.aborted) done(false);
    });
  }

  // Aprieta un control por el usuario. Devuelve true si lo apretó. Después de cada espera mira si
  // la respuesta se cortó: un clic que ya nadie quiere no se hace.
  async function press(el, { label, confirmFirst = false, s = 1, signal } = {}) {
    if (el.matches?.(FIELD) && isSecretField(el)) return false;
    await reveal(el);
    if (signal?.aborted) return false;
    const b = rectOf(el);
    await pen.travel(b.x + Math.min(b.w / 2, 40), b.y + b.h / 2, 0.4 * s);
    if (signal?.aborted) return false;
    if (leavesSimulation(el)) { note(b, 'Eso te saca de la simulación: aquí no lo aprieto'); return false; }
    if (confirmFirst || isRisky(el, label)) {
      const ok = await confirm(el, textOf(el) || 'este control', label, signal);
      if (signal?.aborted) return false;
      if (!ok) { note(b, 'No lo hice'); return false; }
      if (!el.isConnected) return false;
    }
    if (signal?.aborted || !el.isConnected) return false;
    pulse(b);
    sound().click?.();
    el.focus?.({ preventScroll: true });
    await fenced(() => el.click(), b);
    return true;
  }

  // El clic va con cerco: mientras dura no se abren ventanas y no se sale de la simulación. Con la
  // Navigation API la salida se bloquea antes de que pase; sin ella, se vuelve a la dirección de antes
  // con replaceState (history.back() podía sacar de la app si esa navegación no dejó entrada).
  async function fenced(act, b) {
    const here = location.href, state = history.state;
    const nav = window.navigation;
    let blocked = false;
    const onNav = e => {
      if (!e.cancelable || e.hashChange) return;
      if (e.downloadRequest != null || leavesTo(e.destination?.url)) { e.preventDefault(); blocked = true; }
    };
    openFence();
    nav?.addEventListener('navigate', onNav);
    try {
      act();
      for (let t = 0; t < 1200; t += 120) {
        await sleep(120);
        if (blocked) { note(b, 'Eso salía de la simulación: no lo dejé pasar'); break; }
        if (leavesTo(location.href, here)) {
          // sin Navigation API: la dirección de antes y un popstate con su estado, así el router la vuelve a mostrar
          history.replaceState(state, '', here);
          dispatchEvent(new PopStateEvent('popstate', { state }));
          note(b, 'Eso salía de la simulación: te dejé donde estabas');
          break;
        }
      }
    } finally {
      nav?.removeEventListener('navigate', onNav);
      closeFence();
    }
  }

  return {
    async click({ target, label }, s = 1, signal) {
      const el = find(target); if (!el || signal?.aborted) return;
      await press(el, { label, s, signal });
    },

    async type({ target, value }, s = 1, signal) {
      const el = find(target); if (!el || signal?.aborted) return;
      const field = el.matches(FIELD) ? el : el.querySelector(FIELD);
      const b = rectOf(field || el);
      if (!field || field.disabled || field.readOnly || isSecretField(field)) {
        await pen.travel(b.x + 12, b.y + b.h / 2, 0.35 * s);
        if (signal?.aborted) return;
        note(b, isSecretField(field) ? 'Las claves las escribes tú' : 'Ahí no puedo escribir');
        return;
      }
      await reveal(field);
      if (signal?.aborted) return;
      const r = rectOf(field);
      await pen.travel(r.x + 12, r.y + r.h / 2, 0.4 * s);
      if (signal?.aborted) return;
      field.focus({ preventScroll: true });
      const editable = field.isContentEditable;
      const start = editable ? '' : field.value ? field.value.replace(/\s*$/, ' ') : '';
      const text = String(value);
      const per = reducedMotion() ? 0 : Math.max(8, Math.min(32, 900 / text.length)) * Math.min(1, s);
      if (!per) editable ? document.execCommand('insertText', false, text) : setValue(field, start + text);
      else for (let i = 1; i <= text.length; i++) {
        // cortada la respuesta, no escribe ni una letra más (lo escrito queda como borrador)
        if (!field.isConnected || signal?.aborted) return;
        if (editable) document.execCommand('insertText', false, text[i - 1]);
        else setValue(field, start + text.slice(0, i));
        if (i % 3 === 0) sound().click?.();
        await sleep(per);
      }
      if (signal?.aborted) return;
      field.dispatchEvent(new Event('change', { bubbles: true }));
      note(rectOf(field), 'Borrador · revísalo antes de enviar');
      await sleep(200 * s);
    },

    async scroll({ target }, s = 1, signal) {
      const el = find(target); if (!el || signal?.aborted) return;
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      await sleep(reducedMotion() ? 60 : 480);
    },

    // Paso de una guía: la mira sobre el control, una tarjeta "PASO n · qué hacer" con
    // [Hazlo tú] y Esc para salir. La espera (el clic del usuario) la maneja index.js.
    // "Hazlo tú" aprieta con la señal que le pase index.js (la de ese momento).
    async step({ target, label }, s = 1, signal) {
      const el = find(target); if (!el || signal?.aborted) return;
      if (leavesSimulation(el)) { await reveal(el); if (!signal?.aborted) note(rectOf(el), 'Eso está fuera de la simulación'); return; }
      await reveal(el);
      if (signal?.aborted) return;
      const A = ctx.anchor(el), b = rectOf(el, 6);
      await pen.travel(b.x + b.w, b.y + b.h, 0.35 * s);
      if (signal?.aborted) return;
      const lock = htmlEl('div', 'clicky-target clicky-step clicky-pop', A.div, '<span class="glow"></span><span class="lock"><i></i><i></i><i></i><i></i></span>');
      Object.assign(lock.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
      const n = (ctx.walk?.done.length || 0) + 1;
      const card = htmlEl('div', 'clicky-stepper clicky-pop', A.div,
        `<span class="k">Paso ${n}</span><span class="t"></span><button type="button" class="do">Hazlo tú</button><span class="esc"><kbd>Esc</kbd> salir</span>`);
      card.querySelector('.t').textContent = label || 'Aprieta aquí';
      // al lado del control si cabe (así no tapa lo que sigue en una lista); si no, abajo o arriba
      if (b.x + b.w + 12 + card.offsetWidth <= innerWidth - 8) {
        card.style.left = b.x + b.w + 12 + 'px';
        card.style.top = Math.max(4, b.y + b.h / 2 - card.offsetHeight / 2) + 'px';
      } else {
        const below = b.y + b.h + 56 < innerHeight;
        card.style.left = Math.max(8, Math.min(b.x, innerWidth - card.offsetWidth - 8)) + 'px';
        card.style.top = (below ? b.y + b.h + 10 : Math.max(4, b.y - card.offsetHeight - 10)) + 'px';
      }
      ctx.items.push(lock, card);
      if (signal?.aborted) return;
      sound().ping?.();
      onStep?.({ el, label: label || textOf(el), lock, card, doIt: sig => press(el, { label, signal: sig }) });
      await sleep(200 * s);
    },

    press,
    confirm,
  };
}
