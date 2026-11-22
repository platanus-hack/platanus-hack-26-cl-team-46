import { Router } from 'express';
export const r = Router();

r.get('/api/notes/:id', async (req, res) => {
  // IDOR + SQLi: sin filtro de dueño y con interpolación directa.
  const { rows } = await pool.query(`SELECT * FROM notes WHERE id = ${req.params.id}`);
  res.json(rows[0]);
});

r.get('/api/admin/export', async (_req, res) => {
  // Falta requireAdmin.
  res.json(await exportUsers());
});
