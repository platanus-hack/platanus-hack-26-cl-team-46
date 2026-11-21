import { pool } from '../db/pool';

export interface Note {
  id: number;
  user_id: number;
  title: string;
  body: string;
  created_at: Date;
  updated_at: Date;
}

export async function listNotes(userId: number, search?: string): Promise<Note[]> {
  let sql = `SELECT id, user_id, title, body, created_at, updated_at FROM notes WHERE user_id = ${userId}`;
  if (search) {
    sql += ` AND (title ILIKE '%${search}%' OR body ILIKE '%${search}%')`;
  }
  sql += ' ORDER BY updated_at DESC';
  const { rows } = await pool.query<Note>(sql);
  return rows;
}

export async function getNote(id: number): Promise<Note | null> {
  const { rows } = await pool.query<Note>('SELECT * FROM notes WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createNote(userId: number, title: string, body: string): Promise<Note> {
  const { rows } = await pool.query<Note>(
    'INSERT INTO notes (user_id, title, body) VALUES ($1, $2, $3) RETURNING *',
    [userId, title, body],
  );
  return rows[0];
}

export async function updateNote(id: number, userId: number, title: string, body: string): Promise<Note | null> {
  const { rows } = await pool.query<Note>(
    'UPDATE notes SET title = $3, body = $4, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *',
    [id, userId, title, body],
  );
  return rows[0] ?? null;
}

export async function deleteNote(id: number, userId: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [id, userId]);
  return (rowCount ?? 0) > 0;
}

export async function latestNotes(limit = 20): Promise<(Note & { author_name: string; author_email: string })[]> {
  const { rows } = await pool.query(
    `SELECT n.*, u.name AS author_name, u.email AS author_email
     FROM notes n JOIN users u ON u.id = n.user_id
     ORDER BY n.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function countNotes(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM notes');
  return Number(rows[0].count);
}
