import { Router } from 'express';
import { signToken } from '../lib/jwt';
import { logEvent } from '../lib/logger';
import { requireLogin } from '../middleware/auth';
import { createNote, deleteNote, getNote, latestNotes, listNotes } from '../models/notes';
import { createUser, findUserByEmail, listUsers, toPublic } from '../models/users';
import { login } from './auth';
import { updatePassword, updateProfile } from './users';

export const webRouter = Router();

const COOKIE_OPTS = { sameSite: 'lax' as const, maxAge: 30 * 24 * 60 * 60 * 1000 };

webRouter.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { user: null, error: null, email: '' });
});

webRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '');
  const user = await login(req, email, String(req.body?.password ?? ''));
  if (!user) {
    return res.status(401).render('login', { user: null, error: 'Email o contraseña incorrectos', email });
  }
  res.cookie('token', signToken(user), COOKIE_OPTS);
  res.redirect('/');
});

webRouter.get('/register', (req, res) => {
  res.render('register', { user: null, error: null });
});

webRouter.post('/register', async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || !name) {
    return res.status(400).render('register', { user: null, error: 'Completa todos los campos' });
  }
  if (await findUserByEmail(email)) {
    return res.status(409).render('register', { user: null, error: 'Ese email ya está registrado' });
  }
  const user = await createUser({ email, password, name });
  logEvent('user_registered', { user_id: user.id, email: user.email, ip: req.ip });
  res.cookie('token', signToken(user), COOKIE_OPTS);
  res.redirect('/');
});

webRouter.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

webRouter.get('/', requireLogin, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const notes = await listNotes(req.user!.id, q || undefined);
  res.render('dashboard', { user: req.user, notes, q });
});

webRouter.post('/notes', requireLogin, async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (title) {
    await createNote(req.user!.id, title, String(req.body?.body ?? ''));
  }
  res.redirect('/');
});

webRouter.get('/notes/:id', requireLogin, async (req, res) => {
  const note = await getNote(Number(req.params.id));
  if (!note) {
    return res.status(404).render('error', { user: req.user, status: 404, message: 'Nota no encontrada', stack: null });
  }
  res.render('note', { user: req.user, note });
});

webRouter.post('/notes/:id/delete', requireLogin, async (req, res) => {
  await deleteNote(Number(req.params.id), req.user!.id);
  res.redirect('/');
});

webRouter.get('/profile', requireLogin, (req, res) => {
  res.render('profile', { user: req.user, message: null, error: null });
});

webRouter.post('/profile', requireLogin, async (req, res) => {
  const user = await updateProfile(req, req.body ?? {});
  res.render('profile', { user, message: 'Perfil actualizado', error: null });
});

webRouter.post('/profile/password', requireLogin, async (req, res) => {
  const error = await updatePassword(req, String(req.body?.current_password ?? ''), String(req.body?.new_password ?? ''));
  res.status(error ? 400 : 200).render('profile', {
    user: req.user,
    message: error ? null : 'Contraseña actualizada',
    error,
  });
});

webRouter.get('/admin', requireLogin, async (req, res) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).render('error', { user: req.user, status: 403, message: 'Solo administradores', stack: null });
  }
  logEvent('admin_access', { method: req.method, path: req.originalUrl, user_id: req.user!.id, email: req.user!.email, role: req.user!.role, ip: req.ip }, 'warn');
  const users = await listUsers();
  const notes = await latestNotes(20);
  res.render('admin', { user: toPublic(req.user!), users, notes });
});
