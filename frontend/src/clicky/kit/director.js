import { sleep } from './geometry.js';
import { prepareAudio, speak } from './voice.js';

// Rough drawing time of each mark at speed 1, in seconds. The director scales each one to the
// time it has before the next mark's word, as HeyClicky paces its strokes to the line being said.
const COST = {
  ring: 1.3, frame: 1.4, highlight: 0.6, underline: 0.7, num: 0.5, arrow: 1.1, target: 0.7, spotlight: 0.4,
  note: 0.5, button: 0.2,
  card: m => 0.5 + 0.6 * (m.items?.length || 0),
  chart: m => 1 + 0.55 * (m.bars?.length || 0) + (m.note ? 0.6 : 0),
  board: 0.5, node: 0.9, edge: m => (m.label ? 0.75 : 0.55),
};
const cost = m => (typeof COST[m.type] === 'function' ? COST[m.type](m) : COST[m.type] || 0.5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// The pen travels to the element before the stroke shows, so a mark starts this many seconds
// before its word: the stroke lands as the word is said.
const LEAD = 0.3;

// Plays an answer as it streams in: start() returns { push(beat), end(), done }. Each beat is
// one spoken line; each of its marks carries `word`, the word of the line at which it appears.
// Marks are released when the voice reaches their word (from the audio clock), never before.
export function createDirector({ draw, island, voice, onBeat }) {
  let run = 0, wakeCurrent = () => {};

  async function playBeat(beat, id) {
    onBeat?.(beat);
    island.caption(beat.say, { dim: true });
    island.state('speaking');
    const order = beat.marks.map((m, k) => ({ m, k, word: Number.isInteger(m.word) ? m.word : 0 })).sort((a, b) => a.word - b.word || a.k - b.k);
    let heard = -1, next = 0, drawing = Promise.resolve(), times = [], duration = 0, over = false;
    const due = item => item.word <= heard || (times[item.word] ?? 0) - LEAD <= (times[heard] ?? -1);
    const release = () => {
      while (next < order.length && (over || due(order[next]))) {
        const item = order[next++];
        const after = order[next];
        // Time until the next mark is due (or the line ends); once the line is over, draw quickly.
        const room = over ? 0 : (after ? times[after.word] ?? duration : duration) - (times[item.word] ?? 0);
        const s = over ? 0.45 : clamp(room / cost(item.m), 0.45, 1.35);
        drawing = drawing.then(() => id === run && draw(item.m, s)).catch(e => console.warn('[clicky] mark skipped', item.m, e));
      }
    };
    const speech = speak(beat.say, {
      enabled: voice(), audio: beat.audio, el: beat.el,
      onWord: i => { island.word(i); if (i > heard) { heard = i; release(); } },
    });
    times = speech.times; duration = speech.duration;
    await speech.done;
    over = true;
    release();
    await drawing;
    await sleep(80);
  }

  function start() {
    const id = ++run;
    const queue = [];
    let ended = false, wake = () => {};
    wakeCurrent = () => wake();
    const next = async () => {
      while (!queue.length && !ended && id === run) {
        island.state('thinking');
        await new Promise(r => (wake = r));
      }
      return id === run ? queue.shift() : undefined;
    };
    const done = (async () => {
      for (let beat = await next(); beat; beat = await next()) await playBeat(beat, id);
      if (id === run) island.state('idle');
    })();
    return {
      push(beat) {
        if (id !== run) return;
        if (beat.audio?.audio && voice()) beat.el = prepareAudio(beat.audio);
        queue.push(beat);
        wake();
      },
      end() { ended = true; wake(); },
      done,
    };
  }

  return { start, stop() { run++; wakeCurrent(); } };
}
