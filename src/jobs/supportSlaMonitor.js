const cron = require('node-cron');
const { prisma } = require('../lib/prisma');

function getSlaThresholds() {
  const frMin = parseInt(process.env.SUPPORT_SLA_FIRST_RESPONSE_MINUTES || '60', 10);
  const resHours = parseInt(process.env.SUPPORT_SLA_RESOLUTION_HOURS || '72', 10);
  const warnFactor = parseFloat(process.env.SUPPORT_SLA_WARNING_FACTOR || '0.8');
  return { frMin, resHours, warnFactor };
}

function slaStatusForTicket(t, nowMs = Date.now()) {
  const { frMin, resHours, warnFactor } = getSlaThresholds();
  const created = new Date(t.createdAt).getTime();
  const firstResp = t.firstResponseAt ? new Date(t.firstResponseAt).getTime() : null;
  const resolved = t.resolvedAt ? new Date(t.resolvedAt).getTime() : null;

  const frLimit = frMin * 60 * 1000;
  const frWarn = frLimit * warnFactor;
  const frAge = (firstResp ?? nowMs) - created;
  if (!firstResp) {
    if (frAge > frLimit) return 'breached';
    if (frAge > frWarn) return 'warning';
  }

  const resLimit = resHours * 3600 * 1000;
  const resWarn = resLimit * warnFactor;
  const resAge = (resolved ?? nowMs) - created;
  if (!resolved && (t.status === 'open' || t.status === 'in_progress')) {
    if (resAge > resLimit) return 'breached';
    if (resAge > resWarn) return 'warning';
  }
  if (resolved) {
    if (resAge > resLimit) return 'breached';
    if (resAge > resWarn) return 'warning';
  }
  return 'ok';
}

let slaMonitorScheduled = false;
let slaMonitorLastRunAt = null;

function scheduleSupportSlaMonitor() {
  const cronExpr = process.env.SUPPORT_SLA_MONITOR_CRON || '*/15 * * * *'; // every 15 minutes
  slaMonitorScheduled = true;
  cron.schedule(cronExpr, async () => {
    const now = Date.now();
    try {
      const open = await prisma.supportTicket.findMany({
        where: { status: { in: ['open', 'in_progress'] } },
        select: { 
          id: true, 
          subject: true, 
          assignedToUserId: true, 
          requesterUserId: true, 
          createdAt: true, 
          firstResponseAt: true, 
          resolvedAt: true, 
          status: true 
        },
      });
      for (const t of open) {
        const s = slaStatusForTicket(t, now);
        if (s === 'warning') {
          // Notify assignee if any, otherwise broadcast to staff
          try {
            if (t.assignedToUserId) {
              global.wsManager?.sendToUser(t.assignedToUserId, { 
                type: 'warning', 
                title: 'SLA Warning', 
                message: t.subject, 
                data: { ticketId: t.id, event: 'sla_warning' } 
              });
            } else {
              global.wsManager?.broadcastToRole('STAFF', { 
                type: 'warning', 
                title: 'SLA Warning', 
                message: t.subject, 
                data: { ticketId: t.id, event: 'sla_warning' } 
              });
            }
          } catch {}
        } else if (s === 'breached') {
          // Notify managers/admins
          try {
            global.wsManager?.broadcastToRole('MANAGER', { 
              type: 'error', 
              title: 'SLA Breach', 
              message: t.subject, 
              data: { ticketId: t.id, event: 'sla_breached' } 
            });
            global.wsManager?.broadcastToRole('ADMIN', { 
              type: 'error', 
              title: 'SLA Breach', 
              message: t.subject, 
              data: { ticketId: t.id, event: 'sla_breached' } 
            });
          } catch {}
        }
      }
      slaMonitorLastRunAt = new Date();
    } catch (e) {
      console.error('[support-sla-monitor] failed', e);
    }
  });
}

module.exports = {
  scheduleSupportSlaMonitor,
  slaMonitorScheduled,
  slaMonitorLastRunAt
};
