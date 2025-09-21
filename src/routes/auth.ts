import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, requirePermissions } from '../middleware/auth';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { sendNewCustomerNotification } from '../lib/notifications';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6), rememberMe: z.boolean().optional() });

const registerSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
  phone: z.string().optional(),
  acceptTerms: z.boolean().refine(val => val === true, 'You must accept the terms and conditions'),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '7d';

function signAccessToken(sub: string, role: string) {
  const secret = process.env.JWT_ACCESS_SECRET as Secret;
  const options: SignOptions = { expiresIn: ACCESS_TTL as any };
  return jwt.sign({ sub, role }, secret, options);
}
function signRefreshToken(sub: string, role: string) {
  const secret = process.env.JWT_REFRESH_SECRET as Secret;
  const options: SignOptions = { expiresIn: REFRESH_TTL as any };
  return jwt.sign({ sub, role }, secret, options);
}

// ===== OTP utilities =====
const otpEmailSchema = z.object({ email: z.string().email() });
const otpVerifySchema = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/), rememberMe: z.boolean().optional() });

function isAdminLike(role: string) {
  return role === 'ADMIN' || role === 'STAFF'; // manager not present in schema
}

function randomOtpCode() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

async function sendOtpEmail(to: string, code: string) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env as any;
  if (!SMTP_HOST || !SMTP_PORT) {
    console.warn('SMTP not configured; printing OTP to server log for development:', code, '->', to);
    return { mocked: true } as any;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif">`+
    `<h2>RTEXPRESS verification code</h2>`+
    `<p>Your one-time verification code is:</p>`+
    `<div style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</div>`+
    `<p>This code expires in 10 minutes. If you did not request this, please contact an administrator.</p>`+
    `</body></html>`;
  return transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: 'Your RTEXPRESS verification code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html,
  });
}

async function issueTokensAndSetCookie(res: any, user: any, rememberMe?: boolean) {
  const roleStr = user?.role && typeof user.role === 'object' ? user.role?.name : user?.role;
  const role = String(roleStr || 'CUSTOMER').toUpperCase();
  const accessToken = signAccessToken(user.id, role);
  const refreshToken = signRefreshToken(user.id, role);
  const sameSite = (process.env.COOKIE_SAME_SITE as any) || 'lax';
  const isProd = process.env.NODE_ENV === 'production';
  const secure = process.env.COOKIE_SECURE ? (process.env.COOKIE_SECURE === 'true') : isProd;
  const domain = process.env.COOKIE_DOMAIN || undefined;
  const cookieOpts: any = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/auth',
    ...(domain ? { domain } : {}),
  };
  if (rememberMe) cookieOpts.maxAge = 7 * 24 * 60 * 60 * 1000;
  res.cookie('refresh_token', refreshToken, cookieOpts);
  return accessToken;
}

export const router = Router();

// Customer registration endpoint
router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid data',
      details: parsed.error.issues
    });
  }

  const { firstName, lastName, email, password, phone } = parsed.data;

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // Check if customer already exists
    const existingCustomer = await prisma.customer.findUnique({ where: { email } });
    if (existingCustomer) {
      return res.status(409).json({ error: 'Customer with this email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Ensure system CUSTOMER role exists
    const customerRole = await prisma.role.upsert({
      where: { name: 'CUSTOMER' },
      update: { isSystemRole: true },
      create: { name: 'CUSTOMER', description: 'Customer role', isSystemRole: true },
    });

    // Create user account
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        roleId: customerRole.id,
        name: `${firstName} ${lastName}`,
        status: 'ACTIVE',
      },
    });

    // Create customer profile
    const customer = await prisma.customer.create({
      data: {
        type: 'INDIVIDUAL',
        firstName,
        lastName,
        email,
        phone: phone || undefined,
        ownerId: user.id,
        status: 'ACTIVE',
      },
    });

    // Send notification to admins about new customer registration
    await sendNewCustomerNotification(`${firstName} ${lastName}`, email);

    // Generate tokens and set refresh cookie (7d)
    const accessToken = await issueTokensAndSetCookie(res, { id: user.id, role: customerRole.name }, true);

    // Return success response
    res.status(201).json({
      message: 'Registration successful',
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: customerRole.name,
        name: user.name,
      },
      customer: {
        id: customer.id,
        customerNumber: customer.customerNumber,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      },
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const { email, password, rememberMe } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const roleNameRaw = (user as any).role && typeof (user as any).role === 'object' ? (user as any).role?.name : (user as any).role;
  const roleUpper = String(roleNameRaw || 'CUSTOMER').toUpperCase();

  // OTP flow for admin-like roles
  if (isAdminLike(roleUpper)) {
    // Default to enabled for admin-like users if not explicitly set
    const requiresOtp = user.otpEnabled ?? true;
    if (requiresOtp) {
      // Ensure otpEnabled=true persisted
      if (user.otpEnabled !== true) {
        await prisma.user.update({ where: { id: user.id }, data: { otpEnabled: true } });
      }
      // Cleanup expired codes
      await prisma.otpCode.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
      // Generate new code (invalidate previous unused codes by marking used)
      await prisma.otpCode.updateMany({ where: { userId: user.id, used: false }, data: { used: true } });
      const code = randomOtpCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await prisma.otpCode.create({ data: { userId: user.id, code, expiresAt } });
      // Reset attempt counters on new challenge
      await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: 0, otpLastAttempt: null } as any });
      try { await sendOtpEmail(user.email, code); } catch (e) { console.error('OTP email error', e); }
      console.log(`[OTP] Generated for user ${user.email}`);
      return res.json({ requiresOtp: true, message: 'Verification code sent to your email' });
    }
  }

  // Customer flow (or admin-like with OTP disabled)
  const accessToken = await issueTokensAndSetCookie(res, user, rememberMe);
  res.json({ accessToken, user: { id: user.id, email: user.email, role: ((user as any).role?.name || roleUpper), name: user.name } });
});

// OTP status
router.get('/otp-status', async (req, res) => {
  const email = String((req.query as any).email || '').toLowerCase();
  if (!email) return res.json({ requiresOtp: false });
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) return res.json({ requiresOtp: false });
  const roleName = (user as any).role && typeof (user as any).role === 'object' ? (user as any).role?.name : (user as any).role;
  const requiresOtp = isAdminLike(String(roleName || 'CUSTOMER').toUpperCase()) && (user.otpEnabled ?? true);
  res.json({ requiresOtp });
});

// Send OTP (generic)
router.post('/send-otp', async (req, res) => {
  const parsed = otpEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data' });
  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const roleName = (user as any)?.role && typeof (user as any).role === 'object' ? (user as any).role?.name : (user as any)?.role;
  if (!user || !isAdminLike(String(roleName || 'CUSTOMER').toUpperCase())) return res.json({ ok: true }); // do not reveal
  // Cleanup expired and invalidate old
  await prisma.otpCode.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  await prisma.otpCode.updateMany({ where: { userId: user.id, used: false }, data: { used: true } });
  const code = randomOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.otpCode.create({ data: { userId: user.id, code, expiresAt } });
  await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: 0, otpLastAttempt: null } as any });
  try { await sendOtpEmail(user.email, code); } catch (e) { console.error('OTP email error', e); }
  console.log(`[OTP] Sent on demand for user ${user.email}`);
  res.json({ ok: true, message: 'Verification code sent' });
});

// Resend OTP (alias)
router.post('/resend-otp', async (req, res) => {
  const parsed = otpEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data' });
  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const roleName2 = (user as any)?.role && typeof (user as any).role === 'object' ? (user as any).role?.name : (user as any)?.role;
  if (!user || !isAdminLike(String(roleName2 || 'CUSTOMER').toUpperCase())) return res.json({ ok: true });
  await prisma.otpCode.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  await prisma.otpCode.updateMany({ where: { userId: user.id, used: false }, data: { used: true } });
  const code = randomOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.otpCode.create({ data: { userId: user.id, code, expiresAt } });
  await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: 0, otpLastAttempt: null } as any });
  try { await sendOtpEmail(user.email, code); } catch (e) { console.error('OTP email error', e); }
  console.log(`[OTP] Re-sent for user ${user.email}`);
  res.json({ ok: true, message: 'Verification code sent' });
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  const parsed = otpVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data' });
  const { email, code, rememberMe } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) return res.status(401).json({ error: 'Invalid verification code' });
  const roleName3 = (user as any)?.role && typeof (user as any).role === 'object' ? (user as any).role?.name : (user as any)?.role;
  if (!isAdminLike(String(roleName3 || 'CUSTOMER').toUpperCase())) return res.status(400).json({ error: 'OTP not required' });

  // Rate limiting: 5 attempts per 15 minutes
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
  let attempts = user.otpAttempts || 0;
  let last = user.otpLastAttempt ? new Date(user.otpLastAttempt as any) : undefined;
  if (last && last >= windowStart && attempts >= 5) {
    const mins = Math.ceil((last.getTime() - windowStart.getTime()) / (60 * 1000));
    return res.status(429).json({ error: `Too many attempts. Please try again in ${mins} minutes.` });
  }

  // Only accept latest un-used, unexpired code
  const activeCode = await prisma.otpCode.findFirst({
    where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!activeCode || activeCode.code !== code) {
    // Increment attempt counter
    const newAttempts = (last && last >= windowStart) ? attempts + 1 : 1;
    await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: newAttempts, otpLastAttempt: now } });
    const remaining = Math.max(0, 5 - newAttempts);
    return res.status(401).json({ error: `Invalid verification code. ${remaining} attempts remaining.` });
  }

  // Mark code used and reset attempts
  await prisma.otpCode.update({ where: { id: activeCode.id }, data: { used: true } });
  await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: 0, otpLastAttempt: null } as any });

  // Issue tokens now
  const accessToken = await issueTokensAndSetCookie(res, user, rememberMe);
  res.json({ accessToken, user: { id: user.id, email: user.email, role: ((user as any).role?.name || String(roleName3 || 'CUSTOMER').toUpperCase()), name: user.name } });
});


router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ error: 'Missing refresh token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as any;
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (!user) return res.status(401).json({ error: 'Invalid refresh token' });
    const roleName = (user as any)?.role && typeof (user as any).role === 'object' ? (user as any).role?.name : (user as any)?.role;
    const accessToken = signAccessToken(user.id, String(roleName || 'CUSTOMER').toUpperCase());
    res.json({ accessToken });
  } catch (e) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Return current user profile (access token required)
router.get('/me', authenticate, async (req, res) => {
  try {
    const payload = (req as any).user as { sub: string; role: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Load permissions for role
    let permissions: string[] = [];
    if (user.roleId) {
      const role = await prisma.role.findUnique({ where: { id: user.roleId }, include: { permissions: { include: { permission: true } } } });
      permissions = role ? role.permissions.map((rp: any) => `${rp.permission.resource}:${rp.permission.action}`) : [];
    }
    const roleName = (user as any).role?.name || 'CUSTOMER';
    return res.json({ id: user.id, email: user.email, role: roleName, name: user.name, permissions });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load user profile' });
  }
});


// ===== Admin: Dynamic Roles & Permissions =====
const roleCreateSchema = z.object({ name: z.string().min(2), description: z.string().optional() });
const roleUpdateSchema = z.object({ name: z.string().min(2).optional(), description: z.string().optional() });
const permissionCreateSchema = z.object({ name: z.string().min(2), resource: z.string().min(1), action: z.string().min(1), description: z.string().optional() });
const permissionUpdateSchema = z.object({ name: z.string().min(2).optional(), resource: z.string().min(1).optional(), action: z.string().min(1).optional(), description: z.string().optional() });

// List roles
router.get('/admin/roles', authenticate, requirePermissions(['roles:read','roles:manage'], true), async (_req, res) => {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } }, users: true } });
  res.json(roles.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystemRole: r.isSystemRole,
    userCount: r.users.length,
    permissions: r.permissions.map((rp: any) => ({ id: rp.permissionId, name: rp.permission.name })),
  })));
});

// Create role
router.post('/admin/roles', authenticate, requirePermissions(['roles:create','roles:manage'], true), async (req, res) => {
  const parsed = roleCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const exists = await prisma.role.findUnique({ where: { name: parsed.data.name.toUpperCase() } });
  if (exists) return res.status(409).json({ error: 'Role already exists' });
  const role = await prisma.role.create({ data: { name: parsed.data.name.toUpperCase(), description: parsed.data.description, isSystemRole: false } });
  await prisma.auditLog.create({ data: { actorId: (req as any).user.sub, action: 'ROLE_CREATE', entityType: 'Role', entityId: role.id, details: role as any } });
  res.status(201).json(role);
});

// Update role
router.patch('/admin/roles/:id', authenticate, requirePermissions(['roles:update','roles:manage'], true), async (req, res) => {
  const id = String(req.params.id);
  const parsed = roleUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) return res.status(404).json({ error: 'Not found' });
  if (role.isSystemRole && parsed.data.name) return res.status(400).json({ error: 'Cannot rename system role' });
  const updated = await prisma.role.update({ where: { id }, data: { ...parsed.data, name: parsed.data.name ? parsed.data.name.toUpperCase() : undefined } });
  await prisma.auditLog.create({ data: { actorId: (req as any).user.sub, action: 'ROLE_UPDATE', entityType: 'Role', entityId: id, details: parsed.data as any } });
  res.json(updated);
});

// Delete role
router.delete('/admin/roles/:id', authenticate, requirePermissions(['roles:delete','roles:manage'], true), async (req, res) => {
  const id = String(req.params.id);
  const role = await prisma.role.findUnique({ where: { id }, include: { users: true } });
  if (!role) return res.status(404).json({ error: 'Not found' });
  if (role.isSystemRole) return res.status(400).json({ error: 'Cannot delete system role' });
  if (role.users.length > 0) return res.status(400).json({ error: 'Cannot delete role with assigned users' });
  await prisma.rolePermission.deleteMany({ where: { roleId: id } });
  await prisma.role.delete({ where: { id } });
  await prisma.auditLog.create({ data: { actorId: (req as any).user.sub, action: 'ROLE_DELETE', entityType: 'Role', entityId: id } });
  res.json({ ok: true });
});

// List permissions
router.get('/admin/permissions', authenticate, requirePermissions(['permissions:read','permissions:manage'], true), async (_req, res) => {
  const perms = await prisma.permission.findMany();
  res.json(perms);
});

// Create permission
router.post('/admin/permissions', authenticate, requirePermissions(['permissions:create','permissions:manage'], true), async (req, res) => {
  const parsed = permissionCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const exists = await prisma.permission.findUnique({ where: { name: parsed.data.name } });
  if (exists) return res.status(409).json({ error: 'Permission already exists' });
  const perm = await prisma.permission.create({ data: parsed.data });
  await prisma.auditLog.create({ data: { actorId: (req as any).user.sub, action: 'PERMISSION_CREATE', entityType: 'Permission', entityId: perm.id, details: parsed.data as any } });
  res.status(201).json(perm);
});

// Update permission
router.patch('/admin/permissions/:id', authenticate, requirePermissions(['permissions:update','permissions:manage'], true), async (req, res) => {
  const id = String(req.params.id);
  const parsed = permissionUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const updated = await prisma.permission.update({ where: { id }, data: parsed.data });
  await prisma.auditLog.create({ data: { actorId: (req as any).user.sub, action: 'PERMISSION_UPDATE', entityType: 'Permission', entityId: id, details: parsed.data as any } });
  res.json(updated);
});

// Set role permissions (replace)
router.post('/admin/roles/:id/permissions', authenticate, requirePermissions(['roles:assign_permissions','roles:manage'], true), async (req, res) => {
  const id = String(req.params.id);
  const permissionIds: string[] = Array.isArray(req.body?.permissionIds) ? req.body.permissionIds : [];
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.isSystemRole && permissionIds.length === 0) return res.status(400).json({ error: 'System role must retain some permissions' });
  await prisma.rolePermission.deleteMany({ where: { roleId: id } });
  if (permissionIds.length) {
    await prisma.rolePermission.createMany({ data: permissionIds.map(pid => ({ roleId: id, permissionId: pid })) });
  }
  await prisma.auditLog.create({ data: { actorId: (req as any).user.sub, action: 'ROLE_PERMISSIONS_SET', entityType: 'Role', entityId: id, details: { permissionIds } as any } });
  res.json({ ok: true });
});

// Assign role to user
router.patch('/admin/users/:id/role', authenticate, requirePermissions(['users:assign_role','users:manage'], true), async (req, res) => {
  const userId = String(req.params.id);
  const roleId = String(req.body?.roleId || '');
  if (!roleId) return res.status(400).json({ error: 'roleId required' });
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const user = await prisma.user.update({ where: { id: userId }, data: { roleId } });
  await prisma.auditLog.create({ data: { actorId: (req as any).user.sub, action: 'USER_ROLE_SET', entityType: 'User', entityId: userId, details: { roleId } as any } });
  res.json({ ok: true, user: { id: user.id, roleId } });
});


// List users (admin)
router.get('/admin/users', authenticate, requirePermissions(['users:read','users:manage'], true), async (req, res) => {
  const q = String((req.query as any)?.q || '').trim();
  const where: any = q
    ? { OR: [ { email: { contains: q } }, { name: { contains: q } } ] }
    : {};
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      createdAt: true,
      role: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(users.map((u: any) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    createdAt: u.createdAt,
    roleId: u.role?.id || null,
    role: u.role?.name || null,
  })));

});

// Admin: Audit logs
router.get('/admin/audit-logs', authenticate, requirePermissions(['audit_logs:read','audit_logs:manage'], true), async (req, res) => {
  const page = Math.max(1, parseInt(String((req.query as any).page || '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String((req.query as any).pageSize || '20'), 10)));
  const action = String((req.query as any).action || '').trim();
  const actorId = String((req.query as any).actorId || '').trim();
  const entityType = String((req.query as any).entityType || '').trim();
  const where: any = {};
  if (action) where.action = action;
  if (actorId) where.actorId = actorId;
  if (entityType) where.entityType = entityType;
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ page, pageSize, total, items });
});




router.post('/logout', (req, res) => {
  res.clearCookie('refresh_token', { path: '/auth' });
  res.json({ ok: true });
});

// Placeholder for Google OAuth (customer only)
router.get('/google/start', (_req, res) => {
  res.status(501).json({ error: 'Not implemented: Google OAuth start' });
});
router.get('/google/callback', (_req, res) => {
  res.status(501).json({ error: 'Not implemented: Google OAuth callback' });
});

