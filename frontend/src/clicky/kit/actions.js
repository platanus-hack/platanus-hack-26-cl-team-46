import { htmlEl, rectOf, sleep, animate, reducedMotion } from './geometry.js';

// Hinty usa la página por el usuario, como el computer use de HeyClicky: vuela al control, lo
// aprieta, escribe o hace scroll de verdad. Y guía paso a paso: marca el control que toca
// apretar ahora (step) y espera a que el usuario lo haga.
// Límites que no se negocian:
// - Lo irreversible (borrar, terminar, rotar, enviar…) se confirma antes con un chip Sí / No.
// - Lo que escribe queda como borrador: nunca envía un formulario.
// - Nunca escribe en un campo de clave ni de secretos.
const RISKY = /(\btermina(r)?\b|\belimina(r)?\b|\bborra(r)?\b|\breinicia(r)?\b|\brota(r)?\b|\brevoca(r)?\b|\benv[ií]a(r)?\b|\bdesplega(r)?\b|\bdespliega\b|\bpublica(r)?\b|\bdetene(r)?\b|\bdet[eé]n\b|\bapaga(r)?\b|cerrar sesi|\bpaga(r)?\b|\bconfirma(r)?\b|\bacepta(r)?\b|\bdelete\b|\bremove\b|\bkill\b|\bstop\b|\bsend\b|\bsubmit\b|\breset\b|\brotate\b|\brevoke\b|\bdeploy\b|log ?out|sign out|\bpay\b)/i;
const SECRET = /(pass|secret|token|api[-_ ]?key|clave|contrase|credencial|private)/i;
const FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), textarea, [contenteditable=""], [contenteditable=true]';

const textOf = el => String(el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
export const isSecretField = el => !!el && (el.type === 'password' || SECRET.test([el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute?.('aria-label')].join(' ')));
export function isRisky(el, label = '') {
  if (RISKY.test(textOf(el) + ' ' + label)) return true;
  if (el.type === 'submit' || (el.tagName === 'BUTTON' && el.form && el.type !== 'button')) return true; // envía un formulario
  if (el.tagName === 'A' && el.href) { try { return new URL(el.href).origin !== location.origin; } catch { return true; } } // sale de la app
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

  // "¿Lo hago?" junto al control. Se resuelve con Sí, No, Esc o a los 20 s (no).
  function confirm(el, what) {
    const b = rectOf(el, 6);
    const chip = htmlEl('div', 'clicky-confirm clicky-pop', layers.panels,
      `<span class="k">¿Lo hago?</span><span class="t"></span><button type="button" class="yes">Sí, hazlo</button><button type="button" class="no">No</button>`);
    chip.querySelector('.t').textContent = what;
    const below = b.y + b.h + 64 < innerHeight;
    chip.style.left = Math.max(8, Math.min(b.x, innerWidth - chip.offsetWidth - 8)) + 'px';
    chip.style.top = (below ? b.y + b.h + 8 : Math.max(4, b.y - chip.offsetHeight - 8)) + 'px';
    ctx.items.push(chip);
    sound().ping?.();
    return new Promise(resolve => {
      const done = ok => { clearTimeout(timer); removeEventListener('keydown', esc, true); chip.classList.add('clicky-out'); setTimeout(() => chip.remove(), 160); resolve(ok); };
      const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      const timer = setTimeout(() => done(false), 20_000);
      addEventListener('keydown', esc, true);
      chip.querySelector('.yes').onclick = () => done(true);
      chip.querySelector('.no').onclick = () => done(false);
      ctx.cancelConfirm = () => done(false);
    });
  }

  // Aprieta un control por el usuario. Devuelve true si lo apretó.
  async function press(el, { label, confirmFirst = false, s = 1 } = {}) {
    if (el.matches?.(FIELD) && isSecretField(el)) return false;
    await reveal(el);
    const b = rectOf(el);
    await pen.travel(b.x + Math.min(b.w / 2, 40), b.y + b.h / 2, 0.4 * s);
    if (confirmFirst || isRisky(el, label)) {
      const ok = await confirm(el, label || textOf(el) || 'este control');
      if (!ok) { note(b, 'No lo hice'); return false; }
      if (!el.isConnected) return false;
    }
    pulse(b);
    sound().click?.();
    el.focus?.({ preventScroll: true });
    el.click();
    await sleep(360);
    return true;
  }

  return {
    async click({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      await press(el, { label, s });
    },

    async type({ target, value }, s = 1) {
      const el = find(target); if (!el) return;
      const field = el.matches(FIELD) ? el : el.querySelector(FIELD);
      const b = rectOf(field || el);
      if (!field || field.disabled || field.readOnly || isSecretField(field)) {
        await pen.travel(b.x + 12, b.y + b.h / 2, 0.35 * s);
        note(b, isSecretField(field) ? 'Las claves las escribes tú' : 'Ahí no puedo escribir');
        return;
      }
      await reveal(field);
      const r = rectOf(field);
      await pen.travel(r.x + 12, r.y + r.h / 2, 0.4 * s);
      field.focus({ preventScroll: true });
      const editable = field.isContentEditable;
      const start = editable ? '' : field.value ? field.value.replace(/\s*$/, ' ') : '';
      const text = String(value);
      const per = reducedMotion() ? 0 : Math.max(8, Math.min(32, 900 / text.length)) * Math.min(1, s);
      if (!per) editable ? document.execCommand('insertText', false, text) : setValue(field, start + text);
      else for (let i = 1; i <= text.length; i++) {
        if (!field.isConnected) return;
        if (editable) document.execCommand('insertText', false, text[i - 1]);
        else setValue(field, start + text.slice(0, i));
        if (i % 3 === 0) sound().click?.();
        await sleep(per);
      }
      field.dispatchEvent(new Event('change', { bubbles: true }));
      note(rectOf(field), 'Borrador · revísalo antes de enviar');
      await sleep(200 * s);
    },

    async scroll({ target }) {
      const el = find(target); if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      await sleep(reducedMotion() ? 60 : 480);
    },

    // Paso de una guía: la mira sobre el control, una tarjeta "PASO n · qué hacer" con
    // [Hazlo tú] y Esc para salir. La espera (el clic del usuario) la maneja index.js.
    async step({ target, label }, s = 1) {
      const el = find(target); if (!el) return;
      await reveal(el);
      const A = ctx.anchor(el), b = rectOf(el, 6);
      await pen.travel(b.x + b.w, b.y + b.h, 0.35 * s);
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
      sound().ping?.();
      onStep?.({ el, label: label || textOf(el), lock, card, doIt: () => press(el, { label }) });
      await sleep(200 * s);
    },

    press,
    confirm,
  };
}
