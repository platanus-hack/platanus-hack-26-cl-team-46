import { htmlEl, reducedMotion } from './geometry.js';
import { headsetSvg, micSvg, pencilSvg } from './icons.js';

// La barra de Hinty (DESIGN.md › Hinty › 3): baja desde arriba y tapa el header mientras Hinty está
// activo, toda en cian para que se note. Junto con el marco cian de la pantalla dice "estás con Hinty".
// Estados: idle, listening (barras según el micrófono), thinking (3 pixeles en secuencia)
// y speaking (barras a ~8 fps y la punta del micrófono encendida; el subtítulo sigue a la voz).
// A la derecha, el botón redondo para hablar (mismo alto que el input) y el lápiz del modo marcar.
// Los atajos van en una nube que aparece al pasar el cursor.
const BAR_SHAPE = [0.6, 0.9, 1, 0.85, 0.65];
const step4 = v => Math.max(4, Math.min(20, Math.round(v / 4) * 4)); // alturas en pasos de 4 px

// talkKey: la tecla que se mantiene para hablar (fn). onClose: la X que apaga a Hinty.
// onTalk('down' | 'up'): el botón de hablar. onMark(): el lápiz (enciende y apaga el modo marcar; con él, shift dibuja).
export function createIsland(parent, { talkKey = 'fn', onType, onTalk, onMark, onClose, talkCode = 'Fn' } = {}) {
  const kbd = k => `<kbd>${esc(k)}</kbd>`;
  // El marco cian de los bordes de la pantalla: va primero para quedar debajo de los dibujos.
  const frame = htmlEl('div', 'clicky-frame', parent);
  parent.prepend(frame);
  const el = htmlEl('div', 'clicky-island', parent, `
    <div class="av">${headsetSvg(16, { mic: true })}</div>
    <div class="wave">${'<i></i>'.repeat(5)}</div>
    <div class="dots"><i></i><i></i><i></i></div>
    <span class="err"></span>
    <div class="cap"><div class="cap-in"></div></div>
    <div class="hint">
      <span class="tool talk-wrap">
        <button type="button" class="talk" aria-label="Hablar con Hinty: mantén ${esc(talkKey)} o este botón">${micSvg(32)}</button>
        <span class="tip" role="tooltip">
          <b>Hablar con Hinty</b>
          <span>Mantén ${kbd(talkKey)} (o este botón) mientras hablas y suelta para enviar.</span>
          <span class="m">Un clic corto lo deja escuchando hasta que vuelvas a apretarlo.</span>
        </span>
      </span>
      <span class="tool mark-wrap">
        <button type="button" class="mark" aria-label="Modo marcar: con él encendido, mantén shift para marcar la pantalla" aria-pressed="false">${pencilSvg(32)}</button>
        <span class="tip" role="tooltip">
          <b>Modo marcar</b>
          <span>Un clic lo enciende. Con el modo encendido, mantén ${kbd('⇧ shift')} y mueve el cursor sobre lo que quieras mostrarle.</span>
          <span class="m">Lo marcado va con tu próxima pregunta, hablada o escrita. Otro clic lo apaga.</span>
        </span>
      </span>
      ${onClose ? `<span class="sep" aria-hidden="true"></span><button type="button" class="close" aria-label="Cerrar Hinty" title="Cerrar Hinty"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/></svg></button>` : ''}
    </div>`);
  // capIn lleva las palabras; cap recorta y deja a la vista las últimas líneas (la barra no crece).
  const cap = el.querySelector('.cap'), capIn = el.querySelector('.cap-in'), bars = [...el.querySelectorAll('.wave i')];
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
    capIn.innerHTML = '';
    const whole = !dim || reducedMotion();
    words = String(text).split(/\s+/).filter(Boolean).map(w => {
      const s = htmlEl('span', whole ? 'on' : '', capIn);
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
    const close = () => { if (!input.isConnected) return; input.remove(); cap.style.display = ''; delete el.dataset.input; };
    closeInput = close;
    // Shift pasa (con el modo marcar dibuja) y la tecla de hablar también (fn no escribe; si fuera
    // espacio, solo con el input vacío): con el input abierto igual se puede hablar y marcar.
    const modifier = e => e.key === 'Shift' || ((e.code === talkCode || e.key === talkCode) && !input.value);
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
  let closeInput = () => {};
  el.addEventListener('click', openInput);

  // Botón de hablar: lo decide el kit (mantener = hablar mientras está apretado; un clic = queda escuchando).
  // pointerdown sin preventDefault le quitaría el foco a la página, y no se cierra el input al apretar.
  const talk = el.querySelector('.talk'), mark = el.querySelector('.mark');
  let holding = false;
  const release = () => {
    if (!holding) return;
    holding = false;
    talk.classList.remove('held');
    onTalk?.('up');
  };
  talk.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    holding = true;
    talk.setPointerCapture?.(e.pointerId);
    talk.classList.add('held');
    onTalk?.('down');
  });
  talk.addEventListener('pointerup', release);
  talk.addEventListener('pointercancel', release);
  talk.addEventListener('lostpointercapture', release);
  mark.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onMark?.();
  });
  [talk, mark].forEach(b => b.addEventListener('click', e => e.stopPropagation()));
  el.querySelector('.close')?.addEventListener('click', e => { e.stopPropagation(); onClose?.(); });
  el.querySelector('.hint').addEventListener('click', e => e.stopPropagation());

  // El lápiz está encendido mientras se marca la pantalla.
  function marking(on) {
    el.toggleAttribute('data-marking', on);
    mark.setAttribute('aria-pressed', String(on));
  }

  return {
    el, frame, state, level, word, idle, openInput, marking,
    closeInput: () => closeInput(),
    caption(text, opts) { caption(text, opts); },
  };
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
