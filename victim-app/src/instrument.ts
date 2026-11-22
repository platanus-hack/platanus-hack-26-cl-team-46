// Sentry tiene que inicializarse antes que cualquier otro import para instrumentar Express y pg.
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  release: process.env.RENDER_GIT_COMMIT,
  tracesSampleRate: 0.2,
});
