import { Router } from 'express';
import { logEvent } from '../lib/logger';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { countNotes } from '../models/notes';
import { exportUsers, listUsers } from '../models/users';

export const adminRouter = Router();

adminRouter.use(requireAuth);

adminRouter.use((req, _res, next) => {
  logEvent('admin_access', {
    method: req.method,
    path: req.originalUrl,
    user_id: req.user?.id,
    email: req.user?.email,
    role: req.user?.role,
    ip: req.ip,
  }, 'warn');
  next();
});

adminRouter.get('/stats', requireAdmin, async (_req, res) => {
  const users = await listUsers();
  res.json({ users: users.length, notes: await countNotes() });
});

adminRouter.get('/users', requireAdmin, async (_req, res) => {
  res.json(await listUsers());
});

// backup rápido de usuarios en JSON
adminRouter.get('/users/export', async (req, res) => {
  const users = await exportUsers();
  logEvent('admin_export', { user_id: req.user?.id, rows: users.length, ip: req.ip }, 'warn');
  res.setHeader('Content-Disposition', 'attachment; filename="usuarios.json"');
  res.json(users);
});
