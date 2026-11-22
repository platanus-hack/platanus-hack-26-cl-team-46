import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { findUserById } from '../models/users';

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return req.cookies?.token ?? null;
}

// Carga req.user si viene un token válido (header Authorization o cookie)
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next();

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next();
  }

  const user = await findUserById(payload.sub);
  if (user) {
    req.user = user;
    req.tokenIat = payload.iat;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  next();
}

export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}
