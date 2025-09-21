import { Router } from 'express';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pkg from '../../package.json';
import { prisma } from '../lib/prisma';
import { autoCloseScheduled, autoCloseLastRunAt } from '../jobs/supportAutoClose';
import { slaMonitorScheduled, slaMonitorLastRunAt } from '../jobs/supportSlaMonitor';

export const router = Router();

router.get('/', async (_req, res) => {
  const mem = process.memoryUsage();
  // DB check
  let dbOk = false;
  try {
    // Simple ping
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  // WebSocket stats
  const wsClients = (global as any).wsManager?.getConnectedClients?.() || [];
  const wsOk = Array.isArray(wsClients);

  res.json({
    status: dbOk ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    version: (pkg?.version as string) || '0.0.0',
    service: (pkg?.name as string) || 'ship-master-server',
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    checks: {
      db: { ok: dbOk },
      websocket: { ok: wsOk, connected: wsClients.length },
      jobs: {
        autoClose: { scheduled: !!autoCloseScheduled, lastRunAt: autoCloseLastRunAt || null },
        slaMonitor: { scheduled: !!slaMonitorScheduled, lastRunAt: slaMonitorLastRunAt || null },
      },
    },
  });
});

