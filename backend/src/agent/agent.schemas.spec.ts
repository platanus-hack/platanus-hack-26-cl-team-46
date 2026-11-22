import { describe, expect, it } from 'vitest';
import { agentNoteSchema, NOTE_TITLE_MAX } from './agent.schemas.js';

describe('agentNoteSchema', () => {
  it('deja intacto un título corto', () => {
    expect(agentNoteSchema.parse({ title: 'Analizando', body: 'x' })).toEqual({
      title: 'Analizando',
      body: 'x',
    });
  });

  it('acorta un título largo y mueve el texto completo al detalle', () => {
    const title = 'a'.repeat(300);
    const note = agentNoteSchema.parse({ title, body: 'detalle' });
    expect(note.title.length).toBe(NOTE_TITLE_MAX);
    expect(note.title.endsWith('…')).toBe(true);
    expect(note.body).toBe(`${title}\n\ndetalle`);
  });

  it('usa el título como detalle si no venía uno', () => {
    const title = 'b'.repeat(200);
    expect(agentNoteSchema.parse({ title }).body).toBe(title);
  });

  it('rechaza un título vacío', () => {
    expect(agentNoteSchema.safeParse({ title: '   ' }).success).toBe(false);
  });
});
