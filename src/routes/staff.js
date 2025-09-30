const { Router } = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');

const { logAudit } = require('../lib/audit');
const router = Router();

router.use(authenticate);

// Helpers
function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const symbols = '!@#$%&*';
  let password = '';
  password += chars.charAt(crypto.randomInt(0, 26));
  password += chars.charAt(crypto.randomInt(26, 52));
  password += chars.charAt(crypto.randomInt(52, chars.length));
  password += symbols.charAt(crypto.randomInt(0, symbols.length));
  for (let i = 4; i < 12; i++) {
    const allChars = chars + symbols;
    password += allChars.charAt(crypto.randomInt(0, allChars.length));
  }
  return password.split('').sort(() => crypto.randomInt(0, 3) - 1).join('');
}

// List all staff (admin only)
router.get('/', async (req, res) => {
  const user = req.user;
  const ok = await hasPermission(user.sub, 'staff:read');
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const staff = await prisma.user.findMany({
    where: { role: { is: { NOT: { name: 'CUSTOMER' } } } },
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

// Create staff member
router.post('/', async (req, res) => {
  try {
    const user = req.user;
    const ok = await hasPermission(user.sub, 'staff:create');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const createSchema = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      role: z.string().min(2),
      phone: z.string().optional()
    });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });

    const { name, email, role, phone } = parsed.data;

    // Ensure email not used by existing user or customer
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ error: 'Email already in use' });
    const existingCustomer = await prisma.customer.findUnique({ where: { email } }).catch(() => null);
    if (existingCustomer) return res.status(400).json({ error: 'Email already in use' });

    // Resolve role by name, disallow CUSTOMER
    const roleRec = await prisma.role.findUnique({ where: { name: role } });
    if (!roleRec || (roleRec.name || '').toUpperCase() === 'CUSTOMER') {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        roleId: roleRec.id,
        name,
        phone: phone || undefined,
        status: 'ACTIVE',
        mustChangePassword: true,
      },
      include: { role: { select: { name: true } } }
    });

    // For development without SMTP, print credentials
    if (!process.env.SMTP_HOST || !process.env.SMTP_PORT) {
      console.warn(`[STAFF CREATE] Credentials for ${created.email} -> temp password: ${tempPassword}`);
    }

    await logAudit(req, { action: 'STAFF_CREATE', entityType: 'User', entityId: created.id, details: { email: created.email, role: created.role?.name } });
    return res.status(201).json({
      id: created.id,
      name: created.name,
      email: created.email,
      phone: created.phone,
      role: created.role?.name || null,
      status: created.status,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
  } catch (err) {
    console.error('Create staff error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get staff member by ID
router.get('/:id', async (req, res) => {
  try {
    const user = req.user;
    const ok = await hasPermission(user.sub, 'staff:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const id = String(req.params.id);
    const s = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: { select: { name: true } },
        status: true,
        createdAt: true,
        updatedAt: true,
      }
    });
    if (!s || (s.role?.name || '').toUpperCase() === 'CUSTOMER') {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json({ ...s, role: s.role?.name });
  } catch (err) {
    console.error('Get staff error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update staff member
router.patch('/:id', async (req, res) => {
  try {
    const user = req.user;
    const ok = await hasPermission(user.sub, 'staff:update');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const id = String(req.params.id);
    const updateSchema = z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional(),
      role: z.string().min(2).optional(),
      phone: z.string().optional(),
      status: z.enum(['ACTIVE','SUSPENDED']).optional()
    });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });

    const data = parsed.data;

    // Validate email uniqueness if changing
    if (data.email) {
      const existing = await prisma.user.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== id) return res.status(400).json({ error: 'Email already in use' });
      const existingCust = await prisma.customer.findUnique({ where: { email: data.email } }).catch(() => null);
      if (existingCust) return res.status(400).json({ error: 'Email already in use' });
    }

    // Load current target to enforce restrictions
    const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) return res.status(404).json({ error: 'Not found' });
    const currentRoleName = (target.role?.name || '').toUpperCase();

    // Restrict changing roles for ADMIN or CUSTOMER users
    if (data.role && (currentRoleName === 'ADMIN' || currentRoleName === 'CUSTOMER')) {
      return res.status(400).json({ error: 'Cannot change role of CUSTOMER or ADMIN users' });
    }

    // Optional safety: prevent self role change here
    if (data.role && id === user.sub) {
      return res.status(400).json({ error: 'Cannot change your own role here' });
    }

    let roleIdUpdate = undefined;
    if (data.role) {
      const roleRec = await prisma.role.findUnique({ where: { name: data.role } });
      const targetRoleName = (roleRec?.name || '').toUpperCase();
      if (!roleRec || targetRoleName === 'CUSTOMER' || targetRoleName === 'ADMIN') {
        return res.status(400).json({ error: 'Invalid role' });
      }
      roleIdUpdate = roleRec.id;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        status: data.status,
        ...(roleIdUpdate ? { roleId: roleIdUpdate } : {}),
      },
      include: { role: { select: { name: true } } }
    });

    await logAudit(req, { action: 'STAFF_UPDATE', entityType: 'User', entityId: id, details: { changed: data, roleChanged: Boolean(roleIdUpdate) } });

    return res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      role: updated.role?.name || null,
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    console.error('Update staff error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete staff member
router.delete('/:id', async (req, res) => {
  try {
    const user = req.user;
    const ok = await hasPermission(user.sub, 'staff:delete');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const id = String(req.params.id);
    if (id === user.sub) return res.status(400).json({ error: 'Cannot delete yourself' });

    // Ensure target is staff/admin user
    const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target || (target.role?.name || '').toUpperCase() === 'CUSTOMER') {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.user.delete({ where: { id } });
    await logAudit(req, { action: 'STAFF_DELETE', entityType: 'User', entityId: id, details: { email: target.email } });
    return res.status(204).send();
  } catch (err) {
    console.error('Delete staff error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = { router };
