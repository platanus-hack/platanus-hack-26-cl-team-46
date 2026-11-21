import { htmlEl } from './geometry.js';

// The black pill at the top of the screen, like HeyClicky's notch panel.
// States: idle, listening (live waveform), thinking (dots), speaking (caption follows the voice).
export function createIsland(parent, { hint = 'mantén espacio', onType } = {}) {
  const el = htmlEl('div', 'clicky-island', parent, `
    <div class="av"><svg width="12" height="12" viewBox="-10 -10 20 20"><polygon points="0,-8 7,6 -7,6" fill="#fff"/></svg></div>
    <div class="wave">${'<i></i>'.repeat(14)}</div>
    <div class="dots"><i></i><i></i><i></i></div>
    <div class="cap"></div>
    <span class="hint">${hint}</span>`);
  const cap = el.querySelector('.cap'), bars = [...el.querySelectorAll('.wave i')];
  let words = [], idleTimer, speakAnim;

  function state(s) {
    el.dataset.state = s;
    cancelAnimationFrame(speakAnim);
    if (s === 'speaking') {
      const tick = now => { bars.forEach((b, i) => b.style.height = 5 + Math.abs(Math.sin(now / 140 + i * 0.7)) * 14 * (0.5 + 0.5 * Math.sin(now / 400 + i)) + 'px'); speakAnim = requestAnimationFrame(tick); };
      speakAnim = requestAnimationFrame(tick);
    }
    if (s === 'idle') bars.forEach(b => b.style.height = '4px');
  }
  function level(v) { bars.forEach((b, i) => b.style.height = 4 + v * (8 + 12 * Math.abs(Math.sin(i * 1.7 + performance.now() / 90))) + 'px'); }
  function caption(text, { dim = false } = {}) {
    clearTimeout(idleTimer);
    cap.innerHTML = '';
    words = text.split(/\s+/).map(w => { const s = htmlEl('span', dim ? '' : 'on', cap); s.textContent = w + ' '; return s; });
  }
  function word(i) {
    words.forEach((w, k) => w.classList.toggle('on', k <= i));
    words[i]?.scrollIntoView?.({ block: 'nearest', inline: 'end' });
  }
  function idle(text = 'Pregúntame lo que quieras de tu pantalla') { state('idle'); caption(text); cap.style.opacity = .6; }

  function openInput() {
    if (el.querySelector('input')) return el.querySelector('input').focus();
    cap.style.display = 'none';
    const input = htmlEl('input', '', el);
    input.placeholder = 'Escribe tu pregunta y presiona Enter';
    el.insertBefore(input, el.querySelector('.hint'));
    input.focus();
    const close = () => { input.remove(); cap.style.display = ''; };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) { const q = input.value.trim(); close(); onType?.(q); }
      if (e.key === 'Escape') close();
    });
    input.addEventListener('keyup', e => e.stopPropagation());
    input.addEventListener('blur', () => setTimeout(close, 150));
  }
  el.addEventListener('click', openInput);

  return {
    el, state, level, word, idle, openInput,
    caption(text, opts) { cap.style.opacity = 1; caption(text, opts); },
  };
}
