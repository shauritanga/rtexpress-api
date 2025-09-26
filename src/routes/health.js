const { Router } = require('express');
const pkg = require('../../package.json');
const { prisma } = require('../lib/prisma');
const { autoCloseScheduled, autoCloseLastRunAt } = require('../jobs/supportAutoClose');
const { slaMonitorScheduled, slaMonitorLastRunAt } = require('../jobs/supportSlaMonitor');

const router = Router();

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
  const wsClients = global.wsManager?.getConnectedClients?.() || [];
  const wsOk = Array.isArray(wsClients);

  res.json({
    status: dbOk ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    version: pkg?.version || '0.0.0',
    service: pkg?.name || 'ship-master-server',
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

module.exports = { router };
