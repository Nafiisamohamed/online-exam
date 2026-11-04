/**
 * Express application factory.
 *
 * Layers: routes (HTTP + validation) -> services (business rules) -> Prisma (data access).
 * Security: helmet headers, CORS allow-list, JSON body size limit, per-IP rate limit,
 * JWT auth + role checks on every protected route, central error handler.
 * Exported separately from server.ts so tests can run the app without opening a port.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './routes/auth.routes';
import { adminRouter } from './routes/admin.routes';
import { questionRouter } from './routes/question.routes';
import { examRouter } from './routes/exam.routes';
import { attemptRouter } from './routes/attempt.routes';
import { gradingRouter } from './routes/grading.routes';
import { miscRouter } from './routes/misc.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(helmet());
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins.includes('*') ? true : origins, maxAge: 600 }));
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', apiLimiter);

  /** GET /api/health - liveness check. GET /api/time - server clock (used by the exam timer). */
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'imtixaan-api' }));
  app.get('/api/time', (_req, res) => res.json({ serverNow: new Date() }));

  app.use('/api/auth', authRouter);
  // Order matters: specific routers first; each router applies its own auth/role checks.
  app.use('/api', attemptRouter);
  app.use('/api', gradingRouter);
  app.use('/api/exams', examRouter);
  app.use('/api', questionRouter);
  app.use('/api', miscRouter);
  app.use('/api', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
