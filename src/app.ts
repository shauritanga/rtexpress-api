import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { randomUUID } from 'crypto';

import { router as authRouter } from './routes/auth';
import { router as healthRouter } from './routes/health';
import { router as customersRouter } from './routes/customers';
import { router as staffRouter } from './routes/staff';
import { router as shipmentsRouter } from './routes/shipments';
import { router as invoicesRouter } from './routes/invoices';
import { router as paymentsRouter, publicPaymentsRouter } from './routes/payments';
import { router as supportRouter } from './routes/support';
import { router as publicRouter } from './routes/public';
import { router as bookingRequestsRouter } from './routes/bookingRequests';
import { router as notificationsRouter } from './routes/notifications';
import { scheduleSupportAutoClose } from './jobs/supportAutoClose';
import { scheduleSupportSlaMonitor } from './jobs/supportSlaMonitor';


export function createApp() {
  const app = express();

  // Config
  const envSchema = z.object({
    PORT: z.string().default('8080'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: z.string().default('http://localhost:8081'),
    CORS_ALLOWED_ORIGINS: z.string().optional(),
    FRAME_ANCESTORS: z.string().optional(),
    COOKIE_SECURE: z.string().default('false'),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('strict'),
  });
  const env = envSchema.parse(process.env);

  // Security & middleware
  app.set('trust proxy', 1);
  const frameAncestors = env.FRAME_ANCESTORS ? env.FRAME_ANCESTORS.split(',').map(s => s.trim()).filter(Boolean) : null;
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: env.NODE_ENV === 'production'
      ? (frameAncestors ? { directives: { defaultSrc: ["'self'"], frameAncestors } } : undefined)
      : false,
  }));

  const allowedOrigins = env.CORS_ALLOWED_ORIGINS ? env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : null;
  app.use(cors({
    origin: allowedOrigins ? ((origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins!.includes(origin)) return cb(null, true);
      return cb(new Error('CORS not allowed'), false);
    }) : env.CORS_ORIGIN,
    credentials: true,
  }));

  // Optional Sentry (only if installed and DSN provided)
  // @ts-ignore
  let __sentry:any = null; // runtime-optional, avoids adding deps
  try {
    if (process.env.SENTRY_DSN) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      __sentry = require('@sentry/node');
      __sentry.init({ dsn: process.env.SENTRY_DSN, environment: env.NODE_ENV });
      app.use(__sentry.Handlers.requestHandler());
    }
  } catch { console.warn('Sentry not installed; skipping'); }

  // Mount public payments webhook before JSON body parser to preserve raw body for signature verification
  app.use('/payments', publicPaymentsRouter);

  app.use(compression());
  // Serve uploads (attachments)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));


  app.use(express.json());
  app.use(cookieParser());
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // Basic rate limiting
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
  app.use(limiter);

  // Routes
  app.use('/health', healthRouter);
  // Public non-auth routes
  app.use('/public', publicRouter);
  // Auth/auth-admin routes (admin endpoints are defined inside auth router as /admin/*)
  app.use('/auth', authRouter);
  // Expose admin endpoints at top-level /admin/* by also mounting the same router at root
  // Correlation ID + structured log
  app.use((req, res, next) => {
    const reqId = (req.headers['x-request-id'] as string) || randomUUID();
    (req as any).requestId = reqId;
    res.setHeader('X-Request-Id', reqId);
    const start = Date.now();
    res.on('finish', () => {
      const entry = {
        t: new Date().toISOString(),
        level: 'info',
        reqId,
        method: req.method,
        path: (req as any).originalUrl || req.url,
        status: res.statusCode,
        durMs: Date.now() - start,
        userId: (req as any).user?.sub || null,
      };
      try { console.log(JSON.stringify(entry)); } catch { console.log(entry); }
    });
    next();
  });

  // This allows frontend to call /admin/... while keeping /auth/... for auth endpoints
  app.use('/', authRouter);

  app.use('/customers', customersRouter);
  app.use('/shipments', shipmentsRouter);
  app.use('/invoices', invoicesRouter);
  app.use('/staff', staffRouter);
  app.use('/booking-requests', bookingRequestsRouter);
  // Support routes
  app.use('/support', supportRouter);
  // Notification routes
  app.use('/notifications', notificationsRouter);

  // Background jobs
  if (env.NODE_ENV !== 'test') {
    scheduleSupportAutoClose();
    scheduleSupportSlaMonitor();
  }

  // Authenticated payments routes
  app.use('/payments', paymentsRouter);

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const reqId = (req as any).requestId;
    const payload = { t: new Date().toISOString(), level: 'error', reqId, msg: err?.message || 'Unhandled error', stack: (err && err.stack) ? String(err.stack).split('\n').slice(0,5).join(' | ') : undefined };
    try { console.error(JSON.stringify(payload)); } catch { console.error(err); }
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation error', details: err.errors, reqId });
    }
    res.status(err.status || 500).json({ error: 'Internal server error', reqId });
  });

  return app;
}

export const app = createApp();

