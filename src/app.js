require('dotenv/config');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const { z } = require('zod');
const { randomUUID } = require('crypto');

const { router: authRouter } = require('./routes/auth');
const { router: healthRouter } = require('./routes/health');
const { router: customersRouter } = require('./routes/customers');
const { router: staffRouter } = require('./routes/staff');
const { router: shipmentsRouter } = require('./routes/shipments');
const { router: invoicesRouter } = require('./routes/invoices');
const { router: paymentsRouter, publicPaymentsRouter } = require('./routes/payments');
const { router: supportRouter } = require('./routes/support');
const { router: publicRouter } = require('./routes/public');
const { router: bookingRequestsRouter } = require('./routes/bookingRequests');
const { router: notificationsRouter } = require('./routes/notifications');
const { scheduleSupportAutoClose } = require('./jobs/supportAutoClose');
const { scheduleSupportSlaMonitor } = require('./jobs/supportSlaMonitor');

function createApp() {
  const app = express();

  // Config
  const envSchema = z.object({
    PORT: z.string().default('8080'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: z.string().default('https://portal.rtexpress.co.tz'),
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
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS not allowed'), false);
    }) : env.CORS_ORIGIN,
    credentials: true,
  }));

	// Explicitly handle preflight for all routes (defensive; Apache must still pass OPTIONS through)
	app.options('*', cors());


  // Optional Sentry (only if installed and DSN provided)
  let __sentry = null; // runtime-optional, avoids adding deps
  try {
    if (process.env.SENTRY_DSN) {
      __sentry = require('@sentry/node');
      __sentry.init({ dsn: process.env.SENTRY_DSN, environment: env.NODE_ENV });
      app.use(__sentry.Handlers.requestHandler());
    }
  } catch { console.warn('Sentry not installed; skipping'); }

  // Mount public payments webhook before JSON body parser to preserve raw body for signature verification
  app.use('/payments', publicPaymentsRouter);

  app.use(compression());
  // Serve uploads (attachments)
  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

  app.get("/", (req, res) => {
    res.send('RT Express API Server');
  });

	// Simple liveness endpoint (no DB) to verify Node app is serving
	app.get('/healthz', (_req, res) => {
	  res.status(200).json({ ok: true, t: new Date().toISOString() });
	});


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
    const reqId = (req.headers['x-request-id']) || randomUUID();
    req.requestId = reqId;
    res.setHeader('X-Request-Id', reqId);
    const start = Date.now();
    res.on('finish', () => {
      const entry = {
        t: new Date().toISOString(),
        level: 'info',
        reqId,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durMs: Date.now() - start,
        userId: req.user?.sub || null,
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
  app.use((err, req, res, _next) => {
    const reqId = req.requestId;
    const payload = {
      t: new Date().toISOString(),
      level: 'error',
      reqId,
      msg: err?.message || 'Unhandled error',
      stack: (err && err.stack) ? String(err.stack).split('\n').slice(0,5).join(' | ') : undefined
    };
    try { console.error(JSON.stringify(payload)); } catch { console.error(err); }
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation error', details: err.errors, reqId });
    }
    res.status(err.status || 500).json({ error: 'Internal server error', reqId });
  });

  return app;
}

const app = createApp();

module.exports = { createApp, app };
