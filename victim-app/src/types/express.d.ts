import type { User } from '../models/users';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      tokenIat?: number;
    }
  }
}

export {};
