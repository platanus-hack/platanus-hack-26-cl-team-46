import { Router, Request } from 'express';
import { logEvent } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { changePassword, checkPassword, toPublic, updateUser, User } from '../models/users';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/me', (req, res) => {
  res.json(toPublic(req.user!));
});

export async function updateProfile(req: Request, data: Record<string, unknown>): Promise<User> {
  const { user, fields } = await updateUser(req.user!.id, data);
  logEvent('profile_updated', { user_id: user.id, email: user.email, fields, ip: req.ip });
  return user;
}

usersRouter.patch('/me', async (req, res) => {
  const user = await updateProfile(req, req.body ?? {});
  res.json(toPublic(user));
});

export async function updatePassword(req: Request, current: string, next: string): Promise<string | null> {
  const user = req.user!;
  if (!next) return 'La nueva contraseña no puede estar vacía';
  if (!(await checkPassword(user, current))) return 'La contraseña actual no es correcta';

  await changePassword(user.id, next);
  logEvent('password_changed', { user_id: user.id, email: user.email, ip: req.ip, user_agent: req.get('user-agent') });
  return null;
}

usersRouter.post('/me/password', async (req, res) => {
  const { current_password, new_password } = req.body ?? {};
  const error = await updatePassword(req, String(current_password ?? ''), String(new_password ?? ''));
  if (error) {
    return res.status(400).json({ error });
  }
  res.json({ ok: true });
});
