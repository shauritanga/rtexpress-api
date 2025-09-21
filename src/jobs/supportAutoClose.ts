import cron from 'node-cron'
import { prisma } from '../lib/prisma'

export let autoCloseScheduled = false
export let autoCloseLastRunAt: Date | null = null

export function scheduleSupportAutoClose() {
  const days = parseInt(process.env.SUPPORT_AUTO_CLOSE_DAYS || '7', 10)
  const cronExpr = process.env.SUPPORT_AUTO_CLOSE_CRON || '0 2 * * *' // daily at 02:00

  autoCloseScheduled = true

  cron.schedule(cronExpr, async () => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    try {
      // Close tickets resolved before cutoff with no further activity
      const result = await prisma.supportTicket.updateMany({
        where: {
          status: 'resolved',
          updatedAt: { lt: cutoff },
          closedAt: null,
        },
        data: {
          status: 'closed',
          closedAt: new Date(),
          autoClosedAt: new Date(),
        },
      })
      autoCloseLastRunAt = new Date()
      if (result.count > 0) {
        console.log(`[support-auto-close] Closed ${result.count} ticket(s) older than ${days} days`)
      }
    } catch (e) {
      console.error('[support-auto-close] Failed to auto-close tickets', e)
    }
  })
}

