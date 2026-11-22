import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { createNote, deleteNote, getNote, listNotes, updateNote } from '../models/notes';

export const notesRouter = Router();

notesRouter.use(requireAuth);

notesRouter.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  res.json(await listNotes(req.user!.id, q));
});

notesRouter.post('/', async (req, res) => {
  const { title, body } = req.body ?? {};
  if (!title) {
    return res.status(400).json({ error: 'El título es obligatorio' });
  }
  res.status(201).json(await createNote(req.user!.id, String(title), String(body ?? '')));
});

notesRouter.get('/:id', async (req, res) => {
  const note = await getNote(Number(req.params.id));
  if (!note) {
    return res.status(404).json({ error: 'Nota no encontrada' });
  }
  res.json(note);
});

notesRouter.put('/:id', async (req, res) => {
  const { title, body } = req.body ?? {};
  const note = await updateNote(Number(req.params.id), req.user!.id, String(title ?? ''), String(body ?? ''));
  if (!note) {
    return res.status(404).json({ error: 'Nota no encontrada' });
  }
  res.json(note);
});

notesRouter.delete('/:id', async (req, res) => {
  const ok = await deleteNote(Number(req.params.id), req.user!.id);
  if (!ok) {
    return res.status(404).json({ error: 'Nota no encontrada' });
  }
  res.status(204).end();
});
