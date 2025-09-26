const { Router } = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../lib/prisma');
const { authenticate, requireAdmin, requirePermissions } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { sendNewCustomerNotification } = require('../lib/notifications');

const loginSchema = z.object({ 
  email: z.string().email(), 
  password: z.string().min(6), 
  rememberMe: z.boolean().optional() 
});

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

function signAccessToken(sub, role) {
  const secret = process.env.JWT_ACCESS_SECRET;
  const options = { expiresIn: ACCESS_TTL };
  return jwt.sign({ sub, role }, secret, options);
}

function signRefreshToken(sub, role) {
  const secret = process.env.JWT_REFRESH_SECRET;
  const options = { expiresIn: REFRESH_TTL };
  return jwt.sign({ sub, role }, secret, options);
}

// ===== OTP utilities =====
const otpEmailSchema = z.object({ email: z.string().email() });
const otpVerifySchema = z.object({ 
  email: z.string().email(), 
  code: z.string().regex(/^\d{6}$/), 
  rememberMe: z.boolean().optional() 
});

function isAdminLike(role) {
  return role === 'ADMIN' || role === 'STAFF' || role === 'MANAGER';
}

function randomOtpCode() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const symbols = '!@#$%&*';
  let password = '';

  // Ensure at least one uppercase, one lowercase, one number, and one symbol
  password += chars.charAt(crypto.randomInt(0, 26)); // uppercase
  password += chars.charAt(crypto.randomInt(26, 52)); // lowercase
  password += chars.charAt(crypto.randomInt(52, chars.length)); // number
  password += symbols.charAt(crypto.randomInt(0, symbols.length)); // symbol

  // Fill the rest with random characters
  for (let i = 4; i < 12; i++) {
    const allChars = chars + symbols;
    password += allChars.charAt(crypto.randomInt(0, allChars.length));
  }

  // Shuffle the password
  return password.split('').sort(() => crypto.randomInt(0, 3) - 1).join('');
}

async function sendOtpEmail(to, code) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) {
    console.warn('SMTP not configured; printing OTP to server log for development:', code, '->', to);
    return { mocked: true };
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RTEXPRESS - Verification Code</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 40px 30px; text-align: center; }
        .logo { color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: -0.5px; margin: 0; }
        .tagline { color: #e0e7ff; font-size: 14px; margin: 8px 0 0 0; font-weight: 500; }
        .content { padding: 40px 30px; }
        .greeting { font-size: 24px; font-weight: 600; color: #1f2937; margin: 0 0 20px 0; }
        .message { font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 30px 0; }
        .code-container { background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%); border: 2px dashed #d1d5db; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
        .code-label { font-size: 14px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 15px 0; }
        .code { font-size: 36px; font-weight: 800; color: #1e40af; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 0; text-shadow: 0 2px 4px rgba(30, 64, 175, 0.1); }
        .expiry { font-size: 14px; color: #ef4444; font-weight: 600; margin: 15px 0 0 0; }
        .security-notice { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 30px 0; border-radius: 0 8px 8px 0; }
        .security-title { font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 8px 0; }
        .security-text { font-size: 14px; color: #a16207; line-height: 1.5; margin: 0; }
        .footer { background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
        .footer-text { font-size: 14px; color: #6b7280; margin: 0 0 10px 0; }
        .footer-link { color: #1e40af; text-decoration: none; font-weight: 600; }
        .footer-link:hover { text-decoration: underline; }
        .divider { height: 1px; background: linear-gradient(90deg, transparent 0%, #e5e7eb 50%, transparent 100%); margin: 30px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="logo">RTEXPRESS</h1>
            <p class="tagline">Professional Express Delivery Management</p>
        </div>

        <div class="content">
            <h2 class="greeting">Admin Portal Access</h2>
            <p class="message">
                We received a request to access your RTEXPRESS admin account. To complete your login,
                please use the verification code below:
            </p>

            <div class="code-container">
                <p class="code-label">Verification Code</p>
                <p class="code">${code}</p>
                <p class="expiry">⏰ Expires in 10 minutes</p>
            </div>

            <div class="security-notice">
                <p class="security-title">🔒 Security Notice</p>
                <p class="security-text">
                    If you did not request this verification code, please ignore this email and contact
                    your system administrator immediately. Never share this code with anyone.
                </p>
            </div>

            <div class="divider"></div>

            <p class="message">
                This verification code is required for admin portal access and helps keep your account secure.
                Enter this code in the login form to continue.
            </p>
        </div>

        <div class="footer">
            <p class="footer-text">
                This is an automated message from RTEXPRESS Admin Portal.<br>
                For support, contact your system administrator.
            </p>
            <p class="footer-text">
                <a href="#" class="footer-link">RTEXPRESS</a> - Professional Express Delivery Management
            </p>
        </div>
    </div>
</body>
</html>`;
  const textContent = `
RTEXPRESS - Admin Portal Access

Hello,

We received a request to access your RTEXPRESS admin account. To complete your login, please use the verification code below:

VERIFICATION CODE: ${code}

⏰ This code expires in 10 minutes.

🔒 SECURITY NOTICE:
If you did not request this verification code, please ignore this email and contact your system administrator immediately. Never share this code with anyone.

This verification code is required for admin portal access and helps keep your account secure. Enter this code in the login form to continue.

---
This is an automated message from RTEXPRESS Admin Portal.
For support, contact your system administrator.

RTEXPRESS - Professional Express Delivery Management
`;

  return transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: '🔐 RTEXPRESS Admin Portal - Verification Code',
    text: textContent.trim(),
    html,
  });
}

async function sendCustomerWelcomeEmail(to, customerName, temporaryPassword) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) {
    console.warn('SMTP not configured; printing customer credentials to server log for development:');
    console.warn(`Customer: ${customerName} (${to})`);
    console.warn(`Username: ${to}`);
    console.warn(`Temporary Password: ${temporaryPassword}`);
    return { mocked: true };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to RTEXPRESS</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 40px 30px; text-align: center; }
        .logo { color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: -0.5px; margin: 0; }
        .tagline { color: #e0e7ff; font-size: 14px; margin: 8px 0 0 0; font-weight: 500; }
        .content { padding: 40px 30px; }
        .greeting { font-size: 24px; font-weight: 600; color: #1f2937; margin: 0 0 20px 0; }
        .message { font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 30px 0; }
        .credentials-container { background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%); border: 2px solid #d1d5db; border-radius: 12px; padding: 30px; margin: 30px 0; }
        .credentials-title { font-size: 18px; font-weight: 600; color: #1f2937; margin: 0 0 20px 0; text-align: center; }
        .credential-row { display: flex; justify-content: space-between; align-items: center; margin: 15px 0; padding: 15px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; }
        .credential-label { font-size: 14px; color: #6b7280; font-weight: 600; }
        .credential-value { font-size: 16px; color: #1f2937; font-weight: 600; font-family: 'Courier New', monospace; }
        .password-notice { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 30px 0; border-radius: 0 8px 8px 0; }
        .password-title { font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 8px 0; }
        .password-text { font-size: 14px; color: #a16207; line-height: 1.5; margin: 0; }
        .cta-container { text-align: center; margin: 40px 0; }
        .cta-button { display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; text-decoration: none; padding: 15px 30px; border-radius: 8px; font-weight: 600; font-size: 16px; }
        .cta-button:hover { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); }
        .features { background-color: #f9fafb; padding: 30px; margin: 30px 0; border-radius: 12px; }
        .features-title { font-size: 18px; font-weight: 600; color: #1f2937; margin: 0 0 20px 0; text-align: center; }
        .feature-list { list-style: none; padding: 0; margin: 0; }
        .feature-item { padding: 10px 0; color: #4b5563; font-size: 14px; }
        .feature-item:before { content: "✓"; color: #10b981; font-weight: bold; margin-right: 10px; }
        .footer { background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
        .footer-text { font-size: 14px; color: #6b7280; margin: 0 0 10px 0; }
        .footer-link { color: #1e40af; text-decoration: none; font-weight: 600; }
        .footer-link:hover { text-decoration: underline; }
        .divider { height: 1px; background: linear-gradient(90deg, transparent 0%, #e5e7eb 50%, transparent 100%); margin: 30px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="logo">RTEXPRESS</h1>
            <p class="tagline">Professional Express Delivery Management</p>
        </div>

        <div class="content">
            <h2 class="greeting">Welcome to RTEXPRESS, \${customerName}!</h2>
            <p class="message">
                Your customer account has been created by our admin team. You now have access to the
                RTEXPRESS customer portal where you can track shipments, manage bookings, and view invoices.
            </p>

            <div class="credentials-container">
                <h3 class="credentials-title">🔑 Your Login Credentials</h3>
                <div class="credential-row">
                    <span class="credential-label">Email:</span>
                    <span class="credential-value">\${to}</span>
                </div>
                <div class="credential-row">
                    <span class="credential-label">Password:</span>
                    <span class="credential-value">\${temporaryPassword}</span>
                </div>
            </div>

            <div class="password-notice">
                <p class="password-title">🔒 Important Security Notice</p>
                <p class="password-text">
                    For your security, you will be required to change this temporary password when you first log in.
                    Please choose a strong password that you haven't used elsewhere.
                </p>
            </div>

            <div class="cta-container">
                <a href=\${process.env.FRONTEND_ORIGIN || 'http://localhost:8081'}/login class="cta-button">Access Customer Portal</a>
            </div>

            <div class="features">
                <h3 class="features-title">What you can do in the Customer Portal:</h3>
                <ul class="feature-list">
                    <li class="feature-item">Track your shipments in real-time</li>
                    <li class="feature-item">Create and manage booking requests</li>
                    <li class="feature-item">View and download invoices</li>
                    <li class="feature-item">Update your profile and preferences</li>
                    <li class="feature-item">Access delivery history and reports</li>
                    <li class="feature-item">Contact support directly through the portal</li>
                </ul>
            </div>

            <div class="divider"></div>

            <p class="message">
                If you have any questions or need assistance, please don't hesitate to contact our support team.
                We're here to help make your shipping experience as smooth as possible.
            </p>
        </div>

        <div class="footer">
            <p class="footer-text">
                This account was created by RTEXPRESS Team.<br>
                For support, contact us at support@rtexpress.co.tz
            </p>
            <p class="footer-text">
                <a href="#" class="footer-link">RTEXPRESS</a> - Professional Express Delivery Management
            </p>
        </div>
    </div>
</body>
</html>`;

  const textContent = `
RTEXPRESS - Welcome to Your Customer Account

Hello \${customerName},

Your customer account has been created by our admin team. You now have access to the RTEXPRESS customer portal where you can track shipments, manage bookings, and view invoices.

🔑 YOUR LOGIN CREDENTIALS:
Email: \${to}
Password: \${temporaryPassword}

🔒 IMPORTANT SECURITY NOTICE:
For your security, you will be required to change this temporary password when you first log in. Please choose a strong password that you haven't used elsewhere.

CUSTOMER PORTAL ACCESS:
Visit: \${process.env.FRONTEND_ORIGIN || 'http://localhost:8081'}/login

WHAT YOU CAN DO IN THE CUSTOMER PORTAL:
✓ Track your shipments in real-time
✓ Create and manage booking requests
✓ View and download invoices
✓ Update your profile and preferences
✓ Access delivery history and reports
✓ Contact support directly through the portal

If you have any questions or need assistance, please don't hesitate to contact our support team. We're here to help make your shipping experience as smooth as possible.

---
This account was created by RTEXPRESS Admin Team.
For support, contact us at support@rtexpress.co.tz

RTEXPRESS - Professional Express Delivery Management
`;

  return transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: '🎉 Welcome to RTEXPRESS - Your Customer Account is Ready',
    text: textContent.trim(),
    html,
  });
}

async function issueTokensAndSetCookie(res, user, rememberMe) {
  const roleStr = user?.role && typeof user.role === 'object' ? user.role?.name : user?.role;
  const role = String(roleStr || 'CUSTOMER').toUpperCase();
  const accessToken = signAccessToken(user.id, role);
  const refreshToken = signRefreshToken(user.id, role);
  const sameSite = process.env.COOKIE_SAME_SITE || 'lax';
  const isProd = process.env.NODE_ENV === 'production';
  const secure = process.env.COOKIE_SECURE ? (process.env.COOKIE_SECURE === 'true') : isProd;
  const domain = process.env.COOKIE_DOMAIN || undefined;
  const cookieOpts = {
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

const router = Router();

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
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      status: true,
      otpEnabled: true,
      mustChangePassword: true,
      role: {
        select: {
          name: true
        }
      }
    }
  });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  // Check if user is active
  if (user.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Account is not active' });
  }

  const roleUpper = String(user.role?.name || 'CUSTOMER').toUpperCase();

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
      await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: 0, otpLastAttempt: null } });
      try { await sendOtpEmail(user.email, code); } catch (e) { console.error('OTP email error', e); }
      console.log(`[OTP] Generated for user ${user.email}: ${code}`);
      return res.json({ requiresOtp: true, email: user.email, rememberMe });
    }
  }

  // Check if user must change password (for new customers created by admin)
  if (user.mustChangePassword) {
    return res.json({
      requiresPasswordChange: true,
      email: user.email,
      message: 'You must change your password before accessing the system',
    });
  }

  // Generate tokens and set refresh cookie
  const accessToken = await issueTokensAndSetCookie(res, user, rememberMe);

  res.json({
    message: 'Login successful',
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role?.name || 'CUSTOMER',
    },
  });
});

// Change password on first login
const changePasswordSchema = z.object({
  email: z.string().email(),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

router.post('/change-password-first-login', async (req, res) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
    }

    const { email, currentPassword, newPassword } = parsed.data;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        status: true,
        mustChangePassword: true,
        role: {
          select: {
            name: true
          }
        }
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify current password
    const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Check if user is required to change password
    if (!user.mustChangePassword) {
      return res.status(400).json({ error: 'Password change not required' });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update user password and clear mustChangePassword flag
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
      },
    });

    // Generate tokens and set refresh cookie
    const accessToken = await issueTokensAndSetCookie(res, user, false);

    res.json({
      message: 'Password changed successfully',
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role?.name || 'CUSTOMER',
      },
    });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// OTP status
router.get('/otp-status', async (req, res) => {
  const email = String(req.query.email || '').toLowerCase();
  if (!email) return res.json({ requiresOtp: false });
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) return res.json({ requiresOtp: false });
  const roleName = user.role?.name;
  const requiresOtp = isAdminLike(String(roleName || 'CUSTOMER').toUpperCase()) && (user.otpEnabled ?? true);
  res.json({ requiresOtp });
});

// Send OTP (generic)
router.post('/send-otp', async (req, res) => {
  const parsed = otpEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data' });
  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const roleName = user?.role?.name;
  if (!user || !isAdminLike(String(roleName || 'CUSTOMER').toUpperCase())) return res.json({ ok: true }); // do not reveal
  // Cleanup expired and invalidate old
  await prisma.otpCode.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  await prisma.otpCode.updateMany({ where: { userId: user.id, used: false }, data: { used: true } });
  const code = randomOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.otpCode.create({ data: { userId: user.id, code, expiresAt } });
  await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: 0, otpLastAttempt: null } });
  try { await sendOtpEmail(user.email, code); } catch (e) { console.error('OTP email error', e); }
  console.log(`[OTP] Sent on demand for user ${user.email}: ${code}`);
  res.json({ ok: true, message: 'Verification code sent' });
});

// Resend OTP (alias)
router.post('/resend-otp', async (req, res) => {
  const parsed = otpEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data' });
  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const roleName = user?.role?.name;
  if (!user || !isAdminLike(String(roleName || 'CUSTOMER').toUpperCase())) return res.json({ ok: true });
  await prisma.otpCode.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  await prisma.otpCode.updateMany({ where: { userId: user.id, used: false }, data: { used: true } });
  const code = randomOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.otpCode.create({ data: { userId: user.id, code, expiresAt } });
  await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: 0, otpLastAttempt: null } });
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
  const roleName = user.role?.name;
  if (!isAdminLike(String(roleName || 'CUSTOMER').toUpperCase())) return res.status(400).json({ error: 'OTP not required' });

  // Rate limiting: 5 attempts per 15 minutes
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
  let attempts = user.otpAttempts || 0;
  let last = user.otpLastAttempt ? new Date(user.otpLastAttempt) : undefined;
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
  await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: 0, otpLastAttempt: null } });

  // Issue tokens now
  const accessToken = await issueTokensAndSetCookie(res, user, rememberMe);
  res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role?.name || 'CUSTOMER',
      name: user.name
    }
  });
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  try {
    const secret = process.env.JWT_REFRESH_SECRET;
    const payload = jwt.verify(refreshToken, secret);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        role: {
          select: {
            name: true
          }
        }
      }
    });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const accessToken = await issueTokensAndSetCookie(res, user, true);

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role?.name || 'CUSTOMER',
      },
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  res.clearCookie('refresh_token', { path: '/auth' });
  res.json({ message: 'Logged out successfully' });
});

// Get current user info
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        status: true,
        role: {
          select: {
            name: true,
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
        },
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const permissions = user.role?.permissions?.map(rp => `${rp.permission.resource}:${rp.permission.action}`) || [];

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role?.name || 'CUSTOMER',
      permissions,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== Admin: Dynamic Roles & Permissions =====
const roleCreateSchema = z.object({ name: z.string().min(2), description: z.string().optional() });
const roleUpdateSchema = z.object({ name: z.string().min(2).optional(), description: z.string().optional() });
const permissionCreateSchema = z.object({ name: z.string().min(2), resource: z.string().min(1), action: z.string().min(1), description: z.string().optional() });
const permissionUpdateSchema = z.object({ name: z.string().min(2).optional(), resource: z.string().min(1).optional(), action: z.string().min(1).optional(), description: z.string().optional() });

// List roles
router.get('/admin/roles', authenticate, requirePermissions(['roles:read','roles:manage'], true), async (req, res) => {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } }, users: true } });
  res.json(roles.map(r => ({
    ...r,
    permissions: r.permissions.map(rp => rp.permission),
    userCount: r.users.length,
    users: undefined
  })));
});

// Create role
router.post('/admin/roles', authenticate, requirePermissions(['roles:create','roles:manage'], true), async (req, res) => {
  const parsed = roleCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const role = await prisma.role.create({ data: parsed.data });
  res.status(201).json(role);
});

// Update role
router.patch('/admin/roles/:id', authenticate, requirePermissions(['roles:update','roles:manage'], true), async (req, res) => {
  const id = String(req.params.id);
  const parsed = roleUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const role = await prisma.role.update({ where: { id }, data: parsed.data });
  res.json(role);
});

// Delete role
router.delete('/admin/roles/:id', authenticate, requirePermissions(['roles:delete','roles:manage'], true), async (req, res) => {
  try {
    const id = String(req.params.id);
    const role = await prisma.role.findUnique({ where: { id }, include: { users: true } });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.isSystemRole) return res.status(400).json({ error: 'Cannot delete system role' });
    if (role.users.length > 0) return res.status(400).json({ error: 'Cannot delete role with assigned users' });

    // Delete role permissions first to avoid foreign key constraint violation
    await prisma.rolePermission.deleteMany({ where: { roleId: id } });

    // Delete the role
    await prisma.role.delete({ where: { id } });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        actorId: req.user.sub,
        action: 'ROLE_DELETE',
        entityType: 'Role',
        entityId: id
      }
    });

    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List permissions
router.get('/admin/permissions', authenticate, requirePermissions(['permissions:read','permissions:manage'], true), async (req, res) => {
  const perms = await prisma.permission.findMany();
  res.json(perms);
});

// Create permission
router.post('/admin/permissions', authenticate, requirePermissions(['permissions:create','permissions:manage'], true), async (req, res) => {
  const parsed = permissionCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const perm = await prisma.permission.create({ data: parsed.data });
  res.status(201).json(perm);
});

// Update permission
router.patch('/admin/permissions/:id', authenticate, requirePermissions(['permissions:update','permissions:manage'], true), async (req, res) => {
  const id = String(req.params.id);
  const parsed = permissionUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const perm = await prisma.permission.update({ where: { id }, data: parsed.data });
  res.json(perm);
});

// Set role permissions (replace)
router.post('/admin/roles/:id/permissions', authenticate, requirePermissions(['roles:assign_permissions','roles:manage'], true), async (req, res) => {
  const id = String(req.params.id);
  const permissionIds = Array.isArray(req.body?.permissionIds) ? req.body.permissionIds : [];
  await prisma.rolePermission.deleteMany({ where: { roleId: id } });
  if (permissionIds.length > 0) {
    await prisma.rolePermission.createMany({
      data: permissionIds.map(permissionId => ({ roleId: id, permissionId }))
    });
  }
  res.json({ message: 'Role permissions updated' });
});

// Assign role to user
router.patch('/admin/users/:id/role', authenticate, requirePermissions(['users:assign_role','users:manage'], true), async (req, res) => {
  const userId = String(req.params.id);
  const roleId = String(req.body?.roleId || '');
  if (!roleId) return res.status(400).json({ error: 'Role ID required' });
  const user = await prisma.user.update({ where: { id: userId }, data: { roleId } });
  res.json(user);
});

// List users (admin)
router.get('/admin/users', authenticate, requirePermissions(['users:read','users:manage'], true), async (req, res) => {
  const q = String(req.query?.q || '').trim();
  const where = q
    ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] }
    : {};
  const users = await prisma.user.findMany({
    where,
    include: { role: { include: { permissions: { include: { permission: true } } } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    status: u.status,
    roleId: u.role?.id || null,
    role: u.role?.name || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  })));
});

// Admin: Audit logs
router.get('/admin/audit-logs', authenticate, requirePermissions(['audit_logs:read','audit_logs:manage'], true), async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
  const skip = (page - 1) * pageSize;

  const where = {};
  if (req.query.action) where.action = req.query.action;
  if (req.query.entityType) where.entityType = req.query.entityType;
  if (req.query.actorId) where.actorId = req.query.actorId;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.auditLog.count({ where })
  ]);

  res.json({
    logs,
    pagination: {
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize)
    }
  });
});

module.exports = { router };
