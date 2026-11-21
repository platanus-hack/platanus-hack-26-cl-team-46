import { Request, Response, NextFunction } from 'express';
import { logEvent } from '../lib/logger';

export function notFound(req: Request, res: Response) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  res.status(404).render('error', { user: req.user, status: 404, message: 'Página no encontrada', stack: null });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    logEvent(
      'server_error',
      {
        method: req.method,
        path: req.originalUrl,
        user_id: req.user?.id,
        ip: req.ip,
        error: err.message,
        code: err.code,
        stack: err.stack,
      },
      'error',
    );
  }

  const details = {
    error: err.message,
    code: err.code,
    detail: err.detail,
    hint: err.hint,
    position: err.position,
    where: err.where,
    stack: err.stack,
  };

  if (req.path.startsWith('/api/')) {
    return res.status(status).json(details);
  }
  res.status(status).render('error', { user: req.user, status, message: err.message, stack: err.stack });
}
