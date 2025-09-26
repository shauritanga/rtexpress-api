const { prisma } = require('./prisma');

// Lightweight in-memory cache for user permissions (short TTL to limit staleness)
const PERM_TTL_MS = 5000;
const cache = new Map();

async function loadPermissions(userId) {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expires > now) return hit.perms;

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: { select: { permissions: { select: { permission: { select: { resource: true, action: true } } } } } } }
  });
  const perms = new Set((u?.role?.permissions || []).map((rp) => `${rp.permission.resource}:${rp.permission.action}`));
  cache.set(userId, { perms, expires: now + PERM_TTL_MS });
  return perms;
}

// Checks if the user has a specific permission or the resource:manage for that permission
async function hasPermission(userId, perm) {
  const granted = await loadPermissions(userId);
  if (granted.has(perm)) return true;
  const [resource] = perm.split(':');
  return granted.has(`${resource}:manage`);
}

async function hasAnyPermission(userId, perms) {
  const granted = await loadPermissions(userId);
  for (const p of perms) {
    if (granted.has(p)) return true;
    const [resource] = p.split(':');
    if (granted.has(`${resource}:manage`)) return true;
  }
  return false;
}

module.exports = {
  hasPermission,
  hasAnyPermission
};
