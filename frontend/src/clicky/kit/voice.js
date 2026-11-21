// Microphone capture (push-to-talk) and speech output.
export function createRecorder() {
  let rec, stream, ctx, timer, chunks = [];

  async function start(onLevel) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
    chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    timer = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      onLevel?.(Math.min(1, peak / 60));
    }, 50);
  }

  function stop() {
    return new Promise(resolve => {
      if (!rec || rec.state !== 'recording') return resolve(null);
      rec.onstop = () => {
        clearInterval(timer);
        ctx?.close();
        stream.getTracks().forEach(t => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.stop();
    });
  }

  return { start, stop, get recording() { return rec?.state === 'recording'; } };
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

// Plays a voice line synthesized on the server: { audio: base64, mime, words: [start seconds], duration }.
// The caption follows the word start times from the audio clock.
function playAudio(text, { audio, mime = 'audio/mpeg', words: starts = [], duration }, onWord) {
  const el = new Audio(`data:${mime};base64,${audio}`);
  playing = el;
  let raf, next = 0;
  const done = new Promise(resolve => {
    const finish = () => { cancelAnimationFrame(raf); if (playing === el) playing = null; for (; next < starts.length; next++) onWord?.(next); resolve(); };
    const tick = () => {
      while (next < starts.length && el.currentTime >= starts[next]) onWord?.(next++);
      raf = requestAnimationFrame(tick);
    };
    el.onended = finish;
    el.onerror = finish;
    el.onpause = () => { if (!el.ended) finish(); };
    el.play().then(() => { raf = requestAnimationFrame(tick); }).catch(finish);
  });
  return { estimate: duration || Math.max(1.6, text.split(/\s+/).length * 0.34 + 0.4), done };
}

// Speaks a line and reports word positions so the caption can follow the voice.
// Returns an estimated duration so the director can pace the drawing.
// With `audio` (ElevenLabs, from the server) it plays that; otherwise it uses the browser's voice.
export function speak(text, { enabled = true, onWord, audio } = {}) {
  if (enabled && audio?.audio) return playAudio(text, audio, onWord);
  const words = text.split(/\s+/);
  const estimate = Math.max(1.6, words.length * 0.34 + 0.4);
  if (!enabled || !('speechSynthesis' in window)) {
    words.forEach((_, i) => setTimeout(() => onWord?.(i), i * 300));
    return { estimate: words.length * 0.3 + 0.3, done: new Promise(r => setTimeout(r, (words.length * 0.3 + 0.3) * 1000)) };
  }
  const starts = [];
  words.reduce((pos, w) => { starts.push(text.indexOf(w, pos)); return starts.at(-1) + w.length; }, 0);
  const u = new SpeechSynthesisUtterance(text);
  u.voice = pickVoice();
  u.lang = u.voice?.lang || 'es-CL';
  u.rate = 1.04;
  let fallback;
  const done = new Promise(resolve => {
    const finish = () => { clearTimeout(fallback); words.forEach((_, i) => onWord?.(i)); resolve(); };
    u.onend = finish;
    u.onerror = finish;
    fallback = setTimeout(finish, estimate * 1000 + 2500);
  });
  u.onboundary = e => {
    if (e.name && e.name !== 'word') return;
    let i = starts.findIndex((s, k) => e.charIndex >= s && (k === starts.length - 1 || e.charIndex < starts[k + 1]));
    if (i >= 0) onWord?.(i);
  };
  speechSynthesis.speak(u);
  return { estimate, done };
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  playing?.pause();
  playing = null;
}
