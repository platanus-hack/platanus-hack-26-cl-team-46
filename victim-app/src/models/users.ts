import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  phone: string | null;
  bio: string | null;
  role: string;
  created_at: Date;
  updated_at: Date;
}

export type PublicUser = Omit<User, 'password_hash'>;

export function toPublic(user: User): PublicUser {
  const { password_hash: _ignored, ...rest } = user;
  return rest;
}

export async function findUserById(id: number): Promise<User | null> {
  const { rows } = await pool.query<User>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query<User>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] ?? null;
}

export async function createUser(data: { email: string; password: string; name: string }): Promise<User> {
  const hash = await bcrypt.hash(data.password, 10);
  const { rows } = await pool.query<User>(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *',
    [data.email.trim(), hash, data.name.trim()],
  );
  return rows[0];
}

export async function checkPassword(user: User, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.password_hash);
}

// columnas de la tabla users que se pueden actualizar
const USER_COLUMNS = ['name', 'email', 'phone', 'bio', 'role'];

export async function updateUser(id: number, data: Record<string, unknown>): Promise<{ user: User; fields: string[] }> {
  const fields = Object.keys(data).filter((key) => USER_COLUMNS.includes(key));
  if (fields.length === 0) {
    const user = await findUserById(id);
    return { user: user!, fields };
  }
  const sets = fields.map((key, i) => `${key} = $${i + 2}`);
  const values = fields.map((key) => data[key]);
  const { rows } = await pool.query<User>(
    `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  return { user: rows[0], fields };
}

export async function changePassword(id: number, newPassword: string): Promise<void> {
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [id, hash]);
}

export async function listUsers(): Promise<PublicUser[]> {
  const { rows } = await pool.query<PublicUser>(
    'SELECT id, email, name, phone, bio, role, created_at, updated_at FROM users ORDER BY id',
  );
  return rows;
}

export async function exportUsers(): Promise<User[]> {
  const { rows } = await pool.query<User>('SELECT * FROM users ORDER BY id');
  return rows;
}
