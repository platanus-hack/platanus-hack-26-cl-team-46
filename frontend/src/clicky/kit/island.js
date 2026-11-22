import { htmlEl, reducedMotion } from './geometry.js';
import { headsetSvg } from './icons.js';

// La isla de Hinty (DESIGN.md › Hinty › 3): un rectángulo arriba al centro de la columna principal.
// Estados: idle, listening (barras en ink según el micrófono), thinking (3 pixeles en secuencia)
// y speaking (barras cian a ~8 fps y la punta del micrófono encendida; el subtítulo sigue a la voz).
const BAR_SHAPE = [0.6, 0.9, 1, 0.85, 0.65];
const step4 = v => Math.max(4, Math.min(20, Math.round(v / 4) * 4)); // alturas en pasos de 4 px

export function createIsland(parent, { hint = '⌃⌥ / ESPACIO · Mantén apretado para hablar', onType, onClear } = {}) {
  const [key, label] = String(hint).split(' · ');
  const el = htmlEl('div', 'clicky-island', parent, `
    <div class="av">${headsetSvg(16, { mic: true })}</div>
    <div class="wave">${'<i></i>'.repeat(5)}</div>
    <div class="dots"><i></i><i></i><i></i></div>
    <span class="err"></span>
    <div class="cap"></div>
    <span class="hint">${String(key).split(' / ').map(k => `<kbd>${esc(k)}</kbd>`).join('')}${label ? `<span>${esc(label)}</span>` : ''}</span>
    <button type="button" class="x" aria-label="Borrar todo lo que marcó Hinty (Esc)" title="Borrar todo (Esc)">${X_SVG}</button>`);
  const cap = el.querySelector('.cap'), bars = [...el.querySelectorAll('.wave i')];
  let words = [], speakTimer = 0;

  function state(s) {
    el.dataset.state = s;
    clearInterval(speakTimer);
    if (s === 'speaking') {
      if (reducedMotion()) bars.forEach(b => (b.style.height = '12px'));
      else {
        const tick = () => bars.forEach((b, i) => (b.style.height = step4(4 + Math.random() * 18 * BAR_SHAPE[i]) + 'px'));
        tick();
        speakTimer = setInterval(tick, 125);
      }
    }
    if (s === 'idle') bars.forEach(b => (b.style.height = '4px'));
  }
  function level(v) {
    if (reducedMotion()) return bars.forEach(b => (b.style.height = '12px'));
    bars.forEach((b, i) => (b.style.height = step4(4 + v * 18 * BAR_SHAPE[i]) + 'px'));
  }
  // dim: el subtítulo de una frase que se va a decir; sus palabras aparecen con la voz.
  function caption(text, { dim = false, error = false, muted = false } = {}) {
    el.toggleAttribute('data-error', error);
    cap.classList.toggle('muted', muted);
    cap.innerHTML = '';
    const whole = !dim || reducedMotion();
    words = String(text).split(/\s+/).filter(Boolean).map(w => {
      const s = htmlEl('span', whole ? 'on' : '', cap);
      s.textContent = w + ' ';
      return s;
    });
  }
  // La palabra que se acaba de decir va en cian; las anteriores en ink; las que faltan no se muestran.
  function word(i) {
    if (reducedMotion()) return;
    words.forEach((w, k) => {
      w.classList.toggle('on', k <= i);
      w.classList.toggle('now', k === i);
    });
  }
  function idle(text = 'Pregúntame por lo que ves en pantalla') {
    state('idle');
    caption(text, { muted: true });
  }

  function openInput() {
    if (el.querySelector('input')) return el.querySelector('input').focus();
    cap.style.display = 'none';
    const input = htmlEl('input', '', el);
    input.placeholder = 'Escribe tu pregunta y aprieta Enter';
    input.setAttribute('aria-label', 'Pregúntale a Hinty');
    el.insertBefore(input, el.querySelector('.hint'));
    el.dataset.input = '';
    input.focus();
    const close = () => { input.remove(); cap.style.display = ''; delete el.dataset.input; };
    // Control y Option pasan: con el input abierto igual se puede mantener ⌃⌥ para hablar y marcar
    const modifier = e => e.key === 'Control' || e.key === 'Alt';
    input.addEventListener('keydown', e => {
      if (modifier(e)) return;
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) { const q = input.value.trim(); close(); onType?.(q); }
      if (e.key === 'Escape') close();
    });
    input.addEventListener('keyup', e => { if (!modifier(e)) e.stopPropagation(); });
    // se cierra al perder el foco, salvo que vuelva (un clic en la misma isla lo devuelve al input)
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
  }
  el.addEventListener('click', openInput);
  // La ×: borra todas las marcas, tarjetas y pizarra, y corta la explicación (como en HeyClicky).
  // Solo se ve cuando hay algo que borrar (data-clearable).
  el.querySelector('.x').addEventListener('click', e => { e.stopPropagation(); onClear?.(); });
  function clearable(on) { el.toggleAttribute('data-clearable', !!on); }

  return {
    el, state, level, word, idle, openInput, clearable,
    caption(text, opts) { caption(text, opts); },
  };
}

const X_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="square"/></svg>';

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
