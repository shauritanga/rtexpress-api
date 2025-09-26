const jwt = require('jsonwebtoken');
const { prisma } = require('../lib/prisma');

const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.substring('Bearer '.length);
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  const legacySecret = process.env.JWT_SECRET;
  try {
    const payload = jwt.verify(token, accessSecret || legacySecret || '');
    req.user = payload;
    return next();
  } catch (e1) {
    // Fallbacks for legacy tests/dev
    if (legacySecret) {
      try {
        const payload = jwt.verify(token, legacySecret);
        req.user = payload;
        return next();
      } catch {}
    }
    if (process.env.NODE_ENV === 'test') {
      try {
        const payload = jwt.verify(token, 'test-secret');
        req.user = payload;
        return next();
      } catch {}
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.map(r => r.toUpperCase()).includes((user.role || '').toUpperCase())) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const requireAdmin = (req, res, next) => requireRole('ADMIN')(req, res, next);

// Require one or more permissions attached to the user's role
const requirePermissions = (perms, requireAny = false) => async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const u = await prisma.user.findUnique({ 
      where: { id: user.sub }, 
      select: { 
        role: { 
          select: { 
            id: true, 
            permissions: { 
              select: { 
                permission: { 
                  select: { 
                    resource: true, 
                    action: true 
                  } 
                } 
              } 
            } 
          } 
        } 
      } 
    });
    const granted = new Set((u?.role?.permissions || []).map(rp => `${rp.permission.resource}:${rp.permission.action}`));
    // Helper: check if a required perm is satisfied by exact match or by resource:manage
    const satisfies = (p) => {
      if (granted.has(p)) return true;
      const [resource, action] = p.split(':');
      return granted.has(`${resource}:manage`);
    };
    const required = Array.isArray(perms) ? perms : [perms];
    const ok = requireAny ? required.some(satisfies) : required.every(satisfies);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Authorization check failed' });
  }
};

module.exports = {
  authenticate,
  requireRole,
  requireAdmin,
  requirePermissions
};
