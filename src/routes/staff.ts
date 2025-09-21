import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { hasPermission } from '../lib/permissions';
import { authenticate, requireRole } from '../middleware/auth';

export const router = Router();

const createStaffSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  role: z.enum(['ADMIN', 'STAFF'], { required_error: 'Role is required' }),
  phone: z.string().optional().or(z.literal('')),
});

const updateStaffSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['ADMIN', 'STAFF']).optional(),
  phone: z.string().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

router.use(authenticate);




// List all staff (admin only)
router.get('/', async (req, res) => {
  const user = (req as any).user;
  {
    const ok = await hasPermission(user.sub, 'staff:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

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
  res.json(staff.map(s => ({ ...s, role: (s as any).role?.name })));
});

// Get staff member by ID (admin only)
router.get('/:id', async (req, res) => {
  const user = (req as any).user;
  {
    const ok = await hasPermission(user.sub, 'staff:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const { id } = req.params;
  const staff = await prisma.user.findUnique({
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
    },
  });
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });
  res.json({ ...staff, role: (staff as any).role?.name });
});

// Create staff member (admin only)
router.post('/', async (req, res) => {
  const user = (req as any).user;
  {
    const ok = await hasPermission(user.sub, 'staff:create');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  console.log('Staff creation request body:', req.body);
  const parsed = createStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log('Validation failed:', parsed.error.issues);
    return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  }

  const { name, email, role, phone } = parsed.data;

  // Check if email already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(400).json({ error: 'Email already exists' });

  // Create with default password (should be changed on first login)
  const defaultPassword = 'TempPass123!';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  // Ensure the target role exists (system role)
  await prisma.role.upsert({ where: { name: role }, update: {}, create: { name: role, isSystemRole: true } });

  const staff = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      role: { connect: { name: role } },
      passwordHash,
      status: 'ACTIVE',
    },
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
  });

  res.status(201).json({ ...staff, role: (staff as any).role?.name });
});

// Update staff member (admin only)
router.patch('/:id', async (req, res) => {
  const user = (req as any).user;
  {
    const ok = await hasPermission(user.sub, 'staff:update');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const { id } = req.params;
  const parsed = updateStaffSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });

  const data: any = { ...parsed.data };
  if (parsed.data.role) {
    // Ensure role exists then connect by name
    await prisma.role.upsert({ where: { name: parsed.data.role }, update: {}, create: { name: parsed.data.role, isSystemRole: true } });
    (data as any).role = { connect: { name: parsed.data.role } };
  }
  const staff = await prisma.user.update({
    where: { id },
    data,
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
  });

  res.json({ ...staff, role: (staff as any).role?.name });
});

// Delete staff member (admin only)
router.delete('/:id', async (req, res) => {
  const user = (req as any).user;
  {
    const ok = await hasPermission(user.sub, 'staff:delete');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const { id } = req.params;
  await prisma.user.delete({ where: { id } });
  res.status(204).send();
});
