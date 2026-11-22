// Sonidos de Hinty, sintetizados con WebAudio (sin archivos), como el markSound de HeyClicky:
// un roce de plumón mientras se traza, un golpecito al cerrar una flecha, un ping en cada
// objetivo y una campanita al terminar un paso. Cortos y bajitos; solo con la voz encendida.
let ac = null, out = null, noiseBuf = null;

function audio() {
  if (!ac) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ac = new AC();
    out = ac.createGain();
    out.gain.value = 0.55;
    out.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

function noise(a) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

function tone(freq, { at = 0, dur = 0.08, gain = 0.06, type = 'sine', to } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Roce de plumón: ruido filtrado con un leve temblor, del largo del trazo.
function scratch(seconds, { gain = 0.022, freq = 2400, q = 0.8 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime, src = noise(a), bp = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), depth = a.createGain();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  lfo.frequency.value = 13;
  depth.gain.value = gain * 0.45;
  lfo.connect(depth).connect(g.gain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.025);
  g.gain.setValueAtTime(gain, t + Math.max(0.03, seconds - 0.04));
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(bp).connect(g).connect(out);
  src.start(t, Math.random() * 0.8);
  lfo.start(t);
  src.stop(t + seconds + 0.03);
  lfo.stop(t + seconds + 0.03);
}

export function createSounds(enabled = () => true) {
  const on = () => { try { return enabled(); } catch { return false; } };
  return {
    unlock: () => on() && audio(),
    stroke: seconds => on() && seconds > 0.05 && scratch(Math.min(1.2, seconds)),
    flick: () => on() && scratch(0.045, { gain: 0.05, freq: 5200, q: 1.4 }),
    ping: () => { if (on()) { tone(1318, { dur: 0.16, gain: 0.045 }); tone(1976, { at: 0.05, dur: 0.14, gain: 0.025 }); } },
    pop: () => on() && tone(720, { dur: 0.06, gain: 0.035, to: 960 }),
    click: () => on() && tone(2400, { dur: 0.022, gain: 0.05, type: 'square' }),
    done: () => { if (on()) { tone(880, { dur: 0.14, gain: 0.045 }); tone(1318, { at: 0.08, dur: 0.22, gain: 0.045 }); } },
    listen: () => on() && tone(520, { dur: 0.08, gain: 0.04, to: 780 }),
  };
}
