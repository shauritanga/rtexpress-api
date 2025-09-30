const { prisma } = require('./prisma');

/**
 * Audit logging helper
 *
 * Usage:
 *   await logAudit(req, { action: 'INVOICE_CREATE', entityType: 'Invoice', entityId: invoice.id, details: { ... } });
 *   // Optionally override actor when req.user is not available but you know the user id
 *   await logAudit(req, { action: 'AUTH_LOGIN_FAILURE', entityType: 'User', entityId: maybeUserId, details: { email } }, { actorId: maybeUserId });
 *
 * Notes:
 * - This function is best-effort and will never throw; failures are logged to console.
 * - If no actorId can be determined, the event is skipped to satisfy the non-null FK (actorId -> User).
 */
async function logAudit(req, payload, opts = {}) {
  try {
    if (!payload || !payload.action || !payload.entityType) return false;

    const actorId = String(opts.actorId || (req && req.user && req.user.sub) || '') || null;
    if (!actorId) {
      // No actor available; skip to avoid FK violation
      return false;
    }

    const meta = {};
    try {
      meta.ip = (req && (req.ip || (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])))) || undefined;
      meta.userAgent = req && req.headers ? req.headers['user-agent'] : undefined;
      meta.requestId = req && req.id ? req.id : undefined;
      // If the app attaches correlation id differently, add it here
    } catch (_) {}

    const details = payload.details ? { ...payload.details, _meta: meta } : { _meta: meta };

    await prisma.auditLog.create({
      data: {
        actorId,
        action: String(payload.action),
        entityType: String(payload.entityType),
        entityId: payload.entityId ? String(payload.entityId) : null,
        details,
      }
    });
    return true;
  } catch (e) {
    try {
      console.error('[audit] log failure:', e && e.message ? e.message : e);
    } catch (_) {}
    return false;
  }
}

module.exports = { logAudit };

