const { Router } = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { prisma } = require('../lib/prisma');
const { hasPermission } = require('../lib/permissions');
const { authenticate, requireRole } = require('../middleware/auth');

const { logAudit } = require('../lib/audit');
const router = Router();

// Helper function to generate secure temporary password
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

// Helper function to send customer welcome email
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
        .features { background-color: #f9fafb; padding: 30px; margin: 30px 0; border-radius: 12px; }
        .features-title { font-size: 18px; font-weight: 600; color: #1f2937; margin: 0 0 20px 0; text-align: center; }
        .feature-list { list-style: none; padding: 0; margin: 0; }
        .feature-item { padding: 10px 0; color: #4b5563; font-size: 14px; }
        .feature-item:before { content: "✓"; color: #10b981; font-weight: bold; margin-right: 10px; }
        .footer { background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
        .footer-text { font-size: 14px; color: #6b7280; margin: 0 0 10px 0; }
        .footer-link { color: #1e40af; text-decoration: none; font-weight: 600; }
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
            <h2 class="greeting">Welcome to RTEXPRESS, ${customerName}!</h2>
            <p class="message">
                Your customer account has been created by our admin team. You now have access to the
                RTEXPRESS customer portal where you can track shipments, manage bookings, and view invoices.
            </p>

            <div class="credentials-container">
                <h3 class="credentials-title">🔑 Your Login Credentials</h3>
                <div class="credential-row">
                    <span class="credential-label">Email:</span>
                    <span class="credential-value">${to}</span>
                </div>
                <div class="credential-row">
                    <span class="credential-label">Password:</span>
                    <span class="credential-value">${temporaryPassword}</span>
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
                <a href=${process.env.FRONTEND_ORIGIN || 'http://localhost:8081'}/login class="cta-button">Access Customer Portal</a>
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

Hello ${customerName},

Your customer account has been created by our admin team. You now have access to the RTEXPRESS customer portal where you can track shipments, manage bookings, and view invoices.

🔑 YOUR LOGIN CREDENTIALS:
Username (Email): ${to}
Temporary Password: ${temporaryPassword}

🔒 IMPORTANT SECURITY NOTICE:
For your security, you will be required to change this temporary password when you first log in. Please choose a strong password that you haven't used elsewhere.

CUSTOMER PORTAL ACCESS:
Visit: ${process.env.FRONTEND_ORIGIN || 'http://localhost:8081'}/login

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
For support, contact us at support@rtexpress.com

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

const createSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  companyName: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  preferredCurrency: z.string().default('TZS'),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
});

// Customer number is now auto-generated by the database
// Frontend will format it as CUST000001, CUST000002, etc.

router.use(authenticate);

// Get customer's own profile (for customer users)
router.get('/me', async (req, res) => {
  try {
    const jwtUser = req.user;

    // Only allow customer users to access this endpoint
    if (jwtUser.role !== 'CUSTOMER') {
      return res.status(403).json({ error: 'This endpoint is only for customer users' });
    }

    // Find customer by ownerId (stable link to the authenticated user)
    const customer = await prisma.customer.findFirst({
      where: { ownerId: jwtUser.sub },
      include: {
        _count: {
          select: {
            shipments: true
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer profile not found' });
    }

    res.json({
      id: customer.id,
      customerNumber: customer.customerNumber,
      type: customer.type,
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone,
      alternatePhone: customer.alternatePhone,
      preferredCurrency: customer.preferredCurrency,
      street: customer.street,
      city: customer.city,
      state: customer.state,
      zipCode: customer.zipCode,
      country: customer.country,
      status: customer.status,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      shipmentCount: customer._count.shipments,
    });

  } catch (error) {
    console.error('Error fetching customer profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all customers (admin/staff only)
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    if (user.role === 'CUSTOMER') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const ok = await hasPermission(user.sub, 'customers:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const customers = await prisma.customer.findMany({
      include: {
        _count: { select: { shipments: true } }
      }
    });

    // Transform the response to include shipmentCount at the top level
    const customersWithCount = customers.map(customer => ({
      ...customer,
      shipmentCount: customer._count?.shipments || 0,
      _count: undefined // Remove the nested _count object
    }));

    res.json(customersWithCount);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// Get customer by ID (admin/staff only)
router.get('/:id', requireRole('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            shipments: true,
            invoices: true,
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({
      id: customer.id,
      customerNumber: customer.customerNumber,
      type: customer.type,
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone,
      alternatePhone: customer.alternatePhone,
      preferredCurrency: customer.preferredCurrency,
      street: customer.street,
      city: customer.city,
      state: customer.state,
      zipCode: customer.zipCode,
      country: customer.country,
      status: customer.status,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      shipmentCount: customer._count.shipments,
      invoiceCount: customer._count.invoices,
    });

  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create customer (admin/staff only)
router.post('/', requireRole('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
    }

    const data = parsed.data;

    // Check if customer with email already exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { email: data.email }
    });

    if (existingCustomer) {
      return res.status(409).json({ error: 'Customer with this email already exists' });
    }

    // Check if user with email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email }
    });

    // If user exists but no customer, delete the orphaned user first
    if (existingUser) {
      console.log(`Found orphaned user account for ${data.email}, deleting...`);
      await prisma.user.delete({
        where: { id: existingUser.id }
      });
      console.log(`Orphaned user account deleted for ${data.email}`);
    }

    // Get customer role
    const customerRole = await prisma.role.findUnique({
      where: { name: 'CUSTOMER' }
    });

    if (!customerRole) {
      return res.status(500).json({ error: 'Customer role not found' });
    }

    // Generate temporary password
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    // Create user account first
    const customerName = data.type === 'BUSINESS'
      ? data.companyName
      : `${data.firstName || ''} ${data.lastName || ''}`.trim();

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        role: {
          connect: { id: customerRole.id }
        },
        name: customerName,
        status: 'ACTIVE',
        mustChangePassword: true, // Force password change on first login
      },
    });

    // Create customer profile linked to user
    const customer = await prisma.customer.create({
      data: {
        ...data,
        ownerId: user.id, // Link customer to user account
      },
      include: {
        _count: {
          select: {
            shipments: true,
            invoices: true,
          }
        }
      }
    });

    // Send welcome email with credentials
    try {
      await sendCustomerWelcomeEmail(data.email, customerName, temporaryPassword);
      console.log(`Welcome email sent to customer: ${customerName} (${data.email})`);
    } catch (emailError) {
      console.error('Error sending welcome email:', emailError);
      // Don't fail the customer creation if email fails
    }

    await logAudit(req, { action: 'CUSTOMER_CREATE', entityType: 'Customer', entityId: customer.id, details: { email: customer.email, ownerId: user.id } });
    res.status(201).json({
      id: customer.id,
      customerNumber: customer.customerNumber,
      type: customer.type,
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      createdAt: customer.createdAt,
      shipmentCount: customer._count.shipments,
      invoiceCount: customer._count.invoices,
      userCreated: true, // Indicate that user account was created
      welcomeEmailSent: true, // Indicate that welcome email was sent
    });

  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update customer (admin/staff only)
router.patch('/:id', requireRole('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const user = req.user;
    const ok = await hasPermission(user.sub, 'customers:update');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.params;
    const data = req.body;

    // Check if customer exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!existingCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // If email is being updated, check for duplicates
    if (data.email && data.email !== existingCustomer.email) {
      const emailExists = await prisma.customer.findUnique({
        where: { email: data.email }
      });

      if (emailExists) {
        return res.status(409).json({ error: 'Customer with this email already exists' });
      }
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data,
      include: {
        _count: {
          select: {
            shipments: true,
            invoices: true,
          }
        }
      }
    });

    await logAudit(req, { action: 'CUSTOMER_UPDATE', entityType: 'Customer', entityId: id, details: { changed: data } });
    res.json({
      id: updatedCustomer.id,
      customerNumber: updatedCustomer.customerNumber,
      type: updatedCustomer.type,
      firstName: updatedCustomer.firstName,
      lastName: updatedCustomer.lastName,
      companyName: updatedCustomer.companyName,
      email: updatedCustomer.email,
      phone: updatedCustomer.phone,
      alternatePhone: updatedCustomer.alternatePhone,
      preferredCurrency: updatedCustomer.preferredCurrency,
      street: updatedCustomer.street,
      city: updatedCustomer.city,
      state: updatedCustomer.state,
      zipCode: updatedCustomer.zipCode,
      country: updatedCustomer.country,
      status: updatedCustomer.status,
      createdAt: updatedCustomer.createdAt,
      updatedAt: updatedCustomer.updatedAt,
      shipmentCount: updatedCustomer._count.shipments,
      invoiceCount: updatedCustomer._count.invoices,
    });

  } catch (error) {
    console.error('Error updating customer:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Duplicate data', message: 'Customer with this information already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deactivate customer
router.patch('/:id/deactivate', requireRole('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!existingCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Update customer status to inactive
    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        status: 'INACTIVE',
        updatedAt: new Date()
      },
      include: {
        _count: {
          select: {
            shipments: true,
            invoices: true,
          }
        }
      }
    });

    res.json({
      id: updatedCustomer.id,
      customerNumber: updatedCustomer.customerNumber,
      type: updatedCustomer.type,
      firstName: updatedCustomer.firstName,
      lastName: updatedCustomer.lastName,
      companyName: updatedCustomer.companyName,
      email: updatedCustomer.email,
      phone: updatedCustomer.phone,
      alternatePhone: updatedCustomer.alternatePhone,
      preferredCurrency: updatedCustomer.preferredCurrency,
      street: updatedCustomer.street,
      city: updatedCustomer.city,
      state: updatedCustomer.state,
      zipCode: updatedCustomer.zipCode,
      country: updatedCustomer.country,
      status: updatedCustomer.status,
      createdAt: updatedCustomer.createdAt,
      updatedAt: updatedCustomer.updatedAt,
      shipmentCount: updatedCustomer._count.shipments,
      invoiceCount: updatedCustomer._count.invoices,
    });

  } catch (error) {
    console.error('Error deactivating customer:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Suspend customer
router.patch('/:id/suspend', requireRole('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!existingCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Update customer status to suspended
    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        status: 'SUSPENDED',
        updatedAt: new Date()
      },
      include: {
        _count: {
          select: {
            shipments: true,
            invoices: true,
          }
        }
      }
    });

    res.json({
      id: updatedCustomer.id,
      customerNumber: updatedCustomer.customerNumber,
      type: updatedCustomer.type,
      firstName: updatedCustomer.firstName,
      lastName: updatedCustomer.lastName,
      companyName: updatedCustomer.companyName,
      email: updatedCustomer.email,
      phone: updatedCustomer.phone,
      alternatePhone: updatedCustomer.alternatePhone,
      preferredCurrency: updatedCustomer.preferredCurrency,
      street: updatedCustomer.street,
      city: updatedCustomer.city,
      state: updatedCustomer.state,
      zipCode: updatedCustomer.zipCode,
      country: updatedCustomer.country,
      status: updatedCustomer.status,
      createdAt: updatedCustomer.createdAt,
      updatedAt: updatedCustomer.updatedAt,
      shipmentCount: updatedCustomer._count.shipments,
      invoiceCount: updatedCustomer._count.invoices,
    });

  } catch (error) {
    console.error('Error suspending customer:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Activate customer
router.patch('/:id/activate', requireRole('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!existingCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Update customer status to active
    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        updatedAt: new Date()
      },
      include: {
        _count: {
          select: {
            shipments: true,
            invoices: true,
          }
        }
      }
    });

    res.json({
      id: updatedCustomer.id,
      customerNumber: updatedCustomer.customerNumber,
      type: updatedCustomer.type,
      firstName: updatedCustomer.firstName,
      lastName: updatedCustomer.lastName,
      companyName: updatedCustomer.companyName,
      email: updatedCustomer.email,
      phone: updatedCustomer.phone,
      alternatePhone: updatedCustomer.alternatePhone,
      preferredCurrency: updatedCustomer.preferredCurrency,
      street: updatedCustomer.street,
      city: updatedCustomer.city,
      state: updatedCustomer.state,
      zipCode: updatedCustomer.zipCode,
      country: updatedCustomer.country,
      status: updatedCustomer.status,
      createdAt: updatedCustomer.createdAt,
      updatedAt: updatedCustomer.updatedAt,
      shipmentCount: updatedCustomer._count.shipments,
      invoiceCount: updatedCustomer._count.invoices,
    });

  } catch (error) {
    console.error('Error activating customer:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete customer (admin only)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { id },
      include: {
        shipments: true,
        invoices: true,
        owner: true // Include the associated User
      }
    });

    if (!existingCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Check if customer has associated data that would prevent deletion
    if (existingCustomer.shipments.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete customer with existing shipments. Please archive the customer instead.'
      });
    }

    if (existingCustomer.invoices.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete customer with existing invoices. Please archive the customer instead.'
      });
    }

    // Delete the customer and associated user account (if exists)
    await prisma.$transaction(async (tx) => {
      // Delete the customer first
      await tx.customer.delete({
        where: { id }
      });

      // Delete the associated user account if it exists
      if (existingCustomer.owner) {
        await tx.user.delete({
          where: { id: existingCustomer.owner.id }
        });
      }
    });

    await logAudit(req, { action: 'CUSTOMER_DELETE', entityType: 'Customer', entityId: id, details: { ownerId: existingCustomer.owner?.id } });

    res.json({
      success: true,
      message: 'Customer and associated user account deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting customer:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

module.exports = { router };
