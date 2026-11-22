import path from 'path';
import express from 'express';
import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import { pool } from './db/pool';
import { attachUser } from './middleware/auth';
import { requestLog } from './middleware/requestLog';
import { errorHandler, notFound } from './middleware/errors';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { notesRouter } from './routes/notes';
import { adminRouter } from './routes/admin';
import { webRouter } from './routes/web';

export const state = { ready: false };

export function createApp() {
  const app = express();

  app.set('trust proxy', true);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.disable('x-powered-by');

  app.get('/health', async (_req, res) => {
    if (!state.ready) {
      return res.status(503).json({ status: 'starting' });
    }
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(attachUser);
  app.use((req, res, next) => {
    res.locals.user = req.user ?? null;
    next();
  });
  app.use(requestLog);

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/', webRouter);

  app.use(notFound);
  Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);

  return app;
}
