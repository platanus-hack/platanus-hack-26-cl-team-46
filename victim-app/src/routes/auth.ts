import { Router, Request } from 'express';
import { signToken } from '../lib/jwt';
import { logEvent } from '../lib/logger';
import { checkPassword, createUser, findUserByEmail, toPublic, User } from '../models/users';

export const authRouter = Router();

export async function login(req: Request, email: string, password: string): Promise<User | null> {
  const user = email ? await findUserByEmail(email) : null;
  const ok = user ? await checkPassword(user, password) : false;
  if (!user || !ok) {
    logEvent(
      'login_failed',
      {
        email,
        reason: user ? 'bad_password' : 'unknown_user',
        ip: req.ip,
        user_agent: req.get('user-agent'),
      },
      'warn',
    );
    return null;
  }
  logEvent('login_success', { user_id: user.id, email: user.email, ip: req.ip, user_agent: req.get('user-agent') });
  return user;
}

authRouter.post('/register', async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password y name son obligatorios' });
  }
  if (await findUserByEmail(email)) {
    return res.status(409).json({ error: 'Ese email ya está registrado' });
  }
  const user = await createUser({ email, password, name });
  logEvent('user_registered', { user_id: user.id, email: user.email, ip: req.ip });
  res.status(201).json({ token: signToken(user), user: toPublic(user) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await login(req, String(email ?? ''), String(password ?? ''));
  if (!user) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }
  res.json({ token: signToken(user), user: toPublic(user) });
});
