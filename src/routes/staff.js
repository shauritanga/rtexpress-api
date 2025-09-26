const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');

const router = Router();

router.use(authenticate);

// List all staff (admin only)
router.get('/', async (req, res) => {
  const user = req.user;
  const ok = await hasPermission(user.sub, 'staff:read');
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const staff = await prisma.user.findMany({
    where: { role: { is: { name: { in: ['ADMIN', 'STAFF'] } } } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: { select: { name: true } },
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(staff.map(s => ({ ...s, role: s.role?.name })));
});

module.exports = { router };
