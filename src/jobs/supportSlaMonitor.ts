import cron from 'node-cron'
import { prisma } from '../lib/prisma'

// In-memory de-duplication window to avoid spamming the same SLA alerts repeatedly.
// Consider persisting this in DB if you need cross-process resilience.
const lastWarnNotifiedAt = new Map<string, number>() // ticketId -> ms epoch
const lastBreachNotifiedAt = new Map<string, number>() // ticketId -> ms epoch

function getSlaThresholds() {
  const frMin = parseInt((process.env as any).SUPPORT_SLA_FIRST_RESPONSE_MINUTES || '60', 10)
  const resHours = parseInt((process.env as any).SUPPORT_SLA_RESOLUTION_HOURS || '72', 10)
  const warnFactor = parseFloat((process.env as any).SUPPORT_SLA_WARNING_FACTOR || '0.8')
  return { frMin, resHours, warnFactor }
}

function getNotifyIntervals() {
  const warnMin = parseInt((process.env as any).SUPPORT_SLA_WARN_NOTIFY_INTERVAL_MINUTES || '180', 10) // default 3h
  const breachMin = parseInt((process.env as any).SUPPORT_SLA_BREACH_NOTIFY_INTERVAL_MINUTES || '360', 10) // default 6h
  return { warnMs: warnMin * 60 * 1000, breachMs: breachMin * 60 * 1000 }
}

function slaStatusForTicket(t: any, nowMs = Date.now()): 'ok' | 'warning' | 'breached' {
  const { frMin, resHours, warnFactor } = getSlaThresholds()
  const created = new Date(t.createdAt).getTime()
  const firstResp = t.firstResponseAt ? new Date(t.firstResponseAt).getTime() : null
  const resolved = t.resolvedAt ? new Date(t.resolvedAt).getTime() : null

  const frLimit = frMin * 60 * 1000
  const frWarn = frLimit * warnFactor
  const frAge = (firstResp ?? nowMs) - created
  if (!firstResp) {
    if (frAge > frLimit) return 'breached'
    if (frAge > frWarn) return 'warning'
  }

  const resLimit = resHours * 3600 * 1000
  const resWarn = resLimit * warnFactor
  const resAge = (resolved ?? nowMs) - created
  if (!resolved && (t.status === 'open' || t.status === 'in_progress')) {
    if (resAge > resLimit) return 'breached'
    if (resAge > resWarn) return 'warning'
  }
  if (resolved) {
    if (resAge > resLimit) return 'breached'
    if (resAge > resWarn) return 'warning'
  }
  return 'ok'
}

export let slaMonitorScheduled = false
export let slaMonitorLastRunAt: Date | null = null

export function scheduleSupportSlaMonitor() {
  const cronExpr = (process.env as any).SUPPORT_SLA_MONITOR_CRON || '*/15 * * * *' // every 15 minutes
  const monitorEnabled = ((process.env as any).SUPPORT_SLA_MONITOR_ENABLED || 'true').toLowerCase() !== 'false'
  slaMonitorScheduled = true
  const persistEnabled = ((process.env as any).SUPPORT_SLA_PERSIST_DEDUP || 'false').toLowerCase() === 'true'
  cron.schedule(cronExpr, async () => {
    if (!monitorEnabled) return
    const now = Date.now()
    try {
      const select: any = { id: true, subject: true, assignedToUserId: true, requesterUserId: true, createdAt: true, firstResponseAt: true, resolvedAt: true, status: true }
      if (persistEnabled) {
        select.lastSlaWarnNotifiedAt = true
        select.lastSlaBreachNotifiedAt = true
      }
      const open = await prisma.supportTicket.findMany({
        where: { status: { in: ['open', 'in_progress'] } },
        select,
      })
      const { warnMs, breachMs } = getNotifyIntervals()
      for (const t of open) {
        const s = slaStatusForTicket(t, now)
        if (s === 'warning') {
          const last = persistEnabled ? (t as any).lastSlaWarnNotifiedAt ? new Date((t as any).lastSlaWarnNotifiedAt).getTime() : 0 : (lastWarnNotifiedAt.get(t.id) || 0)
          if (now - last < warnMs) continue
          // Notify assignee if any, otherwise broadcast to staff
          try {
            if (t.assignedToUserId) {
              global.wsManager?.sendToUser(t.assignedToUserId, { type: 'warning', title: 'SLA Warning', message: t.subject, data: { ticketId: t.id, event: 'sla_warning' } } as any)
            } else {
              global.wsManager?.broadcastToRole('STAFF', { type: 'warning', title: 'SLA Warning', message: t.subject, data: { ticketId: t.id, event: 'sla_warning' } } as any)
            }
            if (persistEnabled) {
              try { await prisma.supportTicket.update({ where: { id: t.id }, data: { lastSlaWarnNotifiedAt: new Date(now) } }) } catch {}
            } else {
              lastWarnNotifiedAt.set(t.id, now)
            }
          } catch {}
        } else if (s === 'breached') {
          const last = persistEnabled ? (t as any).lastSlaBreachNotifiedAt ? new Date((t as any).lastSlaBreachNotifiedAt).getTime() : 0 : (lastBreachNotifiedAt.get(t.id) || 0)
          if (now - last < breachMs) continue
          // Notify managers/admins
          try {
            global.wsManager?.broadcastToRole('MANAGER', { type: 'error', title: 'SLA Breach', message: t.subject, data: { ticketId: t.id, event: 'sla_breached' } } as any)
            global.wsManager?.broadcastToRole('ADMIN', { type: 'error', title: 'SLA Breach', message: t.subject, data: { ticketId: t.id, event: 'sla_breached' } } as any)
            if (persistEnabled) {
              try { await prisma.supportTicket.update({ where: { id: t.id }, data: { lastSlaBreachNotifiedAt: new Date(now) } }) } catch {}
            } else {
              lastBreachNotifiedAt.set(t.id, now)
            }
          } catch {}
        }
      }
      slaMonitorLastRunAt = new Date()
    } catch (e) {
      console.error('[support-sla-monitor] failed', e)
    }
  })
}

