import { Request, Response, NextFunction } from 'express';
import { logEvent } from '../lib/logger';

export function requestLog(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health') return next();

  const start = Date.now();
  res.on('finish', () => {
    logEvent('http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      bytes: Number(res.getHeader('content-length')) || undefined,
      ip: req.ip,
      user_agent: req.get('user-agent'),
      user_id: req.user?.id,
      token_iat: req.tokenIat,
    });
  });
  next();
}
