import { sleep } from './geometry.js';
import { speak } from './voice.js';

// Rough drawing time of each mark at speed 1, in seconds. The director scales them so a
// beat's marks finish while its sentence is being spoken, as HeyClicky paces drawing to speech.
const COST = {
  ring: 1.3, frame: 1.4, highlight: 0.6, underline: 0.7, num: 0.5, arrow: 1.1, target: 0.7, spotlight: 0.4,
  note: 0.5, button: 0.2,
  card: m => 0.5 + 0.6 * (m.items?.length || 0),
  chart: m => 1 + 0.55 * (m.bars?.length || 0) + (m.note ? 0.6 : 0),
  diagram: m => 0.4 + 0.5 * (m.nodes?.length || 0) + 0.5 * (m.edges?.length || 0),
};
const cost = m => (typeof COST[m.type] === 'function' ? COST[m.type](m) : COST[m.type] || 0.5);

export function createDirector({ draw, island, voice, onBeat }) {
  let run = 0;

  async function play(beats) {
    const id = ++run;
    for (const beat of beats) {
      if (id !== run) return;
      onBeat?.(beat);
      island.caption(beat.say, { dim: true });
      island.state('speaking');
      const speech = speak(beat.say, { enabled: voice(), audio: beat.audio, onWord: i => island.word(i) });
      const total = beat.marks.reduce((a, m) => a + cost(m), 0);
      const s = total ? Math.min(1.35, Math.max(0.55, speech.estimate / total)) : 1;
      for (const m of beat.marks) {
        if (id !== run) return;
        try { await draw(m, s); } catch (e) { console.warn('[clicky] mark skipped', m, e); }
      }
      await speech.done;
      await sleep(160);
    }
    if (id === run) island.state('idle');
  }

  return { play, stop() { run++; } };
}
