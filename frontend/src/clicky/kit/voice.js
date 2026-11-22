// Microphone (push-to-talk) and speech output.

// The worklet hands the raw microphone frames to the page; the page converts them to 16 kHz PCM.
const WORKLET = `class ClickyPcm extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('clicky-pcm', ClickyPcm);`;
const RATE = 16000;
const CHUNK = RATE / 10; // 100 ms per message

function toBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Push-to-talk. While the key is held, the audio goes straight to ElevenLabs' realtime
// transcription (a WebSocket with a single-use token from the backend), so the text is ready
// the moment the key is released, and the island shows it as the user speaks. It also records
// the whole clip, in case the live connection fails: then the caller uploads it instead.
export function createVoiceInput() {
  let stream, ctx, node, rec, chunks, ws, starting = null, state = null;

  async function start({ url = null, onPartial, onLevel } = {}) {
    const s = state = { queue: [], pending: new Int16Array(CHUNK), fill: 0, committed: [], partial: '', failed: !url, open: false, sent: 0, waiters: [] };
    starting = (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
      chunks = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.start();

      ctx = new AudioContext();
      const step = ctx.sampleRate / RATE;
      let carry = 0;
      const blobUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
      node = new AudioWorkletNode(ctx, 'clicky-pcm');
      node.port.onmessage = ({ data: frame }) => {
        let peak = 0;
        for (let i = 0; i < frame.length; i++) peak = Math.max(peak, Math.abs(frame[i]));
        onLevel?.(Math.min(1, peak * 2.2));
        if (s.failed) return;
        // Downsample to 16 kHz (nearest sample is enough for speech) into 100 ms chunks.
        let t = carry;
        for (; t < frame.length; t += step) {
          const v = Math.max(-1, Math.min(1, frame[Math.floor(t)]));
          s.pending[s.fill++] = v < 0 ? v * 0x8000 : v * 0x7fff;
          if (s.fill === CHUNK) { send(s, s.pending, false); s.pending = new Int16Array(CHUNK); s.fill = 0; }
        }
        carry = t - frame.length;
      };
      ctx.createMediaStreamSource(stream).connect(node);
    })();

    if (url) Promise.resolve(url).then(u => connect(s, u, onPartial), () => { s.failed = true; });
    await starting;
  }

  function connect(s, url, onPartial) {
    if (!url || s !== state) { s.failed = true; return; }
    const socket = ws = new WebSocket(url);
    const fail = why => { if (!s.failed) console.warn('[clicky] dictado en vivo:', why); s.failed = true; s.waiters.splice(0).forEach(w => w()); };
    socket.onopen = () => { s.open = true; s.queue.splice(0).forEach(m => socket.send(m)); s.waiters.splice(0).forEach(w => w()); };
    socket.onerror = () => fail('no se pudo conectar');
    socket.onclose = () => { s.open = false; s.waiters.splice(0).forEach(w => w()); };
    socket.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.message_type === 'partial_transcript') {
        s.partial = msg.text || '';
        const live = [...s.committed, s.partial].join(' ').trim();
        if (live) onPartial?.(live);
      } else if (msg.message_type === 'committed_transcript') {
        if (msg.text?.trim()) s.committed.push(msg.text.trim());
        s.partial = '';
        s.waiters.splice(0).forEach(w => w());
      } else if (/error|exceeded|throttled|limited|overflow|unaccepted|exhausted|insufficient/.test(msg.message_type || '')) {
        fail(msg.message_type + (msg.error ? ': ' + msg.error : ''));
      }
    };
  }

  function send(s, int16, commit) {
    s.sent++;
    const msg = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: toBase64(int16), commit, sample_rate: RATE });
    if (s.open) ws.send(msg);
    else s.queue.push(msg);
  }

  const within = (ms, s, cond) => new Promise(resolve => {
    if (cond()) return resolve();
    const timer = setTimeout(resolve, ms);
    const check = () => (cond() ? (clearTimeout(timer), resolve()) : s.waiters.push(check));
    s.waiters.push(check);
  });

  // Stops listening. Returns { text } when the live transcription worked, and the recorded
  // clip as `blob` so the caller can fall back to uploading it.
  async function stop() {
    const s = state;
    if (!s) return { text: null, blob: null };
    await starting?.catch(() => {});
    node?.port && (node.port.onmessage = null);
    const blob = await new Promise(resolve => {
      if (!rec || rec.state !== 'recording') return resolve(null);
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      rec.stop();
    });
    stream?.getTracks().forEach(t => t.stop());
    ctx?.close();
    let text = null;
    if (!s.failed && s.sent + s.fill > 0) {
      // Send what is left and ask for the final text of the whole utterance.
      const before = s.committed.length;
      send(s, s.pending.slice(0, Math.max(1, s.fill)), true);
      await within(1500, s, () => s.open || s.failed);
      await within(1800, s, () => s.committed.length > before || s.failed || !s.open);
      text = (s.committed.join(' ') || s.partial).trim() || null;
      if (s.failed && !s.committed.length) text = null;
    }
    try { ws?.close(); } catch {}
    ws = null; state = null;
    return { text, blob };
  }

  return { start, stop, get recording() { return !!state; } };
}

const PREFERRED = ['es-CL', 'es-419', 'es-MX', 'es-US', 'es-ES'];
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('es'));
  for (const lang of PREFERRED) {
    const v = voices.find(x => x.lang === lang && /premium|enhanced|mejorad/i.test(x.name)) || voices.find(x => x.lang === lang);
    if (v) return v;
  }
  return voices[0] || null;
}
if ('speechSynthesis' in window) speechSynthesis.getVoices();

let playing = null;
// La frase que suena ahora (voz del servidor, del navegador o sin voz). stopSpeaking() la corta con
// cut(): mueren sus timers, no suelta las palabras que faltaban y su `done` se resuelve igual.
let line = null;

// Server voice lines are decoded ahead of time, as soon as the beat arrives, so they start at once.
export function prepareAudio({ audio, mime = 'audio/mpeg' }) {
  const el = new Audio(`data:${mime};base64,${audio}`);
  el.preload = 'auto';
  el.load();
  return el;
}

// Plays a voice line synthesized on the server: { audio: base64, mime, words: [start seconds], duration }.
// Words are reported from the audio clock, so whatever follows them (caption, marks) is in sync.
function playAudio(text, audio, el, { onWord, onStart }) {
  el = el || prepareAudio(audio);
  playing = el;
  const starts = audio.words || [];
  let raf, next = 0, over = false;
  const done = new Promise(resolve => {
    // al terminar suelta las palabras que falten (y sus marcas); cortada, no
    const end = all => { if (over) return; over = true; cancelAnimationFrame(raf); if (playing === el) playing = null; if (all) for (; next < starts.length; next++) onWord?.(next); resolve(); };
    const finish = () => end(true);
    const tick = () => {
      if (over) return;
      while (next < starts.length && el.currentTime >= starts[next]) onWord?.(next++);
      raf = requestAnimationFrame(tick);
    };
    el.onended = finish;
    el.onerror = finish;
    el.onpause = () => { if (!el.ended) finish(); };
    el.onplaying = () => { if (over) return; onStart?.(); raf = requestAnimationFrame(tick); };
    line = { cut: () => { end(false); el.pause(); } };
    el.play().catch(finish);
  });
  const duration = audio.duration || Math.max(1.6, text.split(/\s+/).length * 0.34 + 0.4);
  return { times: starts.length ? starts : estimateTimes(text, duration), duration, done };
}

const estimateTimes = (text, duration) => {
  const words = text.split(/\s+/);
  return words.map((_, i) => (i * duration) / words.length);
};

// Speaks a line and reports each word as it is said (onWord) and when the voice starts (onStart).
// Returns the start time of every word, so the director can time the drawing to the voice.
// With `audio` (ElevenLabs, from the server) it plays that; otherwise it uses the browser's voice.
export function speak(text, { enabled = true, onWord, onStart, audio, el } = {}) {
  if (enabled && audio?.audio) return playAudio(text, audio, el, { onWord, onStart });
  const words = text.split(/\s+/);
  const duration = Math.max(1.6, words.length * 0.34 + 0.4);
  const times = estimateTimes(text, duration);
  if (!enabled || !('speechSynthesis' in window)) {
    onStart?.();
    const timers = words.map((_, i) => setTimeout(() => onWord?.(i), times[i] * 1000));
    let end = () => {};
    const done = new Promise(r => {
      const last = setTimeout(() => end(), duration * 1000);
      end = () => { clearTimeout(last); timers.forEach(clearTimeout); r(); };
    });
    line = { cut: () => end() };
    return { times, duration, done };
  }
  const starts = [];
  words.reduce((pos, w) => { starts.push(text.indexOf(w, pos)); return starts.at(-1) + w.length; }, 0);
  const u = new SpeechSynthesisUtterance(text);
  u.voice = pickVoice();
  u.lang = u.voice?.lang || 'es-CL';
  u.rate = 1.04;
  let fallback, clock, heard = -1, over = false, cut = () => {};
  const say = i => { if (!over && i > heard) { for (let k = heard + 1; k <= i; k++) onWord?.(k); heard = i; } };
  const done = new Promise(resolve => {
    const end = all => { if (over) return; if (all) say(words.length - 1); over = true; clearTimeout(fallback); clearInterval(clock); resolve(); };
    u.onend = () => end(true);
    u.onerror = () => end(true);
    fallback = setTimeout(() => end(true), duration * 1000 + 4000);
    cut = () => end(false);
  });
  line = { cut };
  // Many browser voices never report word boundaries: then words follow an estimated clock.
  u.onstart = () => {
    if (over) return;
    onStart?.();
    const t0 = performance.now();
    say(0);
    clock = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      let i = heard;
      while (i + 1 < times.length && times[i + 1] <= t) i++;
      say(i);
    }, 90);
  };
  u.onboundary = e => {
    if (e.name && e.name !== 'word') return;
    const i = starts.findIndex((s, k) => e.charIndex >= s && (k === starts.length - 1 || e.charIndex < starts[k + 1]));
    if (i >= 0) say(i);
  };
  speechSynthesis.speak(u);
  return { times, duration, done };
}

export function stopSpeaking() {
  line?.cut();
  line = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  playing?.pause();
  playing = null;
}
