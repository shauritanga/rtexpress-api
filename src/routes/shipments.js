const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { logAudit } = require('../lib/audit');
const { authenticate, requireRole } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');
const { sendShipmentNotification, sendNewShipmentNotification } = require('../lib/notifications');
const nodemailer = require('nodemailer');

const router = Router();

// Shipment status enum for validation
const ShipmentStatus = z.enum([
  'Pending',
  'Processing',
  'Ready for Pickup',
  'Picked Up',
  'In Transit',
  'Out for Delivery',
  'Delivered',
  'Failed Delivery Attempt',
  'Returned to Sender',
  'Cancelled',
  'Lost',
  'Damaged'
]);

const Priority = z.enum(['low', 'medium', 'high', 'urgent']);

// Date transformation helper
const dateTransform = (fieldName) => z.string().optional().transform((val) => {
  if (!val) return undefined;
  // Handle datetime-local input format (YYYY-MM-DDTHH:MM)
  if (val.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
    return new Date(val + ':00.000Z').toISOString();
  }
  // Try to parse as ISO date
  const date = new Date(val);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName} format`);
  }
  return date.toISOString();
});

const createSchema = z.object({
  customerId: z.string(),
  description: z.string().min(1, 'Description is required'),
  packageType: z.string().min(1, 'Package type is required'),
  weightValue: z.number().positive('Weight must be positive'),
  weightUnit: z.string().min(1, 'Weight unit is required'),
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  dimensionUnit: z.string().optional(),
  value: z.number().positive('Value must be positive'),
  currency: z.string().default('TZS'),
  priority: Priority.default('medium'),
  status: ShipmentStatus.default('Pending'),
  originStreet: z.string().min(1, 'Origin street is required'),
  originCity: z.string().min(1, 'Origin city is required'),
  originState: z.string().min(1, 'Origin state is required'),
  originZip: z.string().min(1, 'Origin zip is required'),
  originCountry: z.string().min(1, 'Origin country is required'),
  destStreet: z.string().min(1, 'Destination street is required'),
  destCity: z.string().min(1, 'Destination city is required'),
  destState: z.string().min(1, 'Destination state is required'),
  destZip: z.string().min(1, 'Destination zip is required'),
  destCountry: z.string().min(1, 'Destination country is required'),
  pickupDate: dateTransform('pickup date'),
  estimatedDelivery: dateTransform('estimated delivery date'),
  insuranceValue: z.number().nonnegative().optional(),
  signatureRequired: z.boolean().default(false),
});

async function generateNextTrackingNumber() {
  const prefix = '0255';
  // Find the current max tracking number starting with 0255
  const last = await prisma.shipment.findMany({
    select: { trackingNumber: true },
    where: { trackingNumber: { startsWith: prefix } },
    orderBy: { trackingNumber: 'desc' },
    take: 1,
  });
  const current = last[0]?.trackingNumber;
  const currentNum = current && current.startsWith(prefix) ? parseInt(current.slice(prefix.length), 10) : 0;
  const nextNum = isNaN(currentNum) ? 1 : currentNum + 1;
  const suffix = String(nextNum).padStart(8, '0');
  return prefix + suffix;
}

// Helper function to send new shipment email to admins
async function sendNewShipmentEmailToAdmins(customerName, trackingNumber, shipmentDetails) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) {
    console.warn('SMTP not configured; skipping new shipment email notification');
    return { mocked: true };
  }

  try {
    // Get all admin users
    const adminUsers = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: { name: { in: ['ADMIN', 'STAFF'] } }
      },
      select: { email: true, firstName: true, lastName: true }
    });

    if (adminUsers.length === 0) {
      console.warn('No admin users found for new shipment email notification');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });

    const html = `<!doctype html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #dc2626, #2563eb); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; font-size: 24px;">🚚 New Shipment Created</h1>
    </div>

    <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
      <p style="margin-top: 0;"><strong>A new shipment has been created by a customer and requires your attention.</strong></p>

      <div style="background: white; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <h3 style="margin-top: 0; color: #dc2626;">Shipment Details</h3>
        <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
        <p><strong>Customer:</strong> ${customerName}</p>
        <p><strong>Description:</strong> ${shipmentDetails.description}</p>
        <p><strong>Package Type:</strong> ${shipmentDetails.packageType}</p>
        <p><strong>Weight:</strong> ${shipmentDetails.weightValue} ${shipmentDetails.weightUnit}</p>
        <p><strong>Value:</strong> ${shipmentDetails.value} ${shipmentDetails.currency}</p>
        <p><strong>Priority:</strong> ${shipmentDetails.priority}</p>
      </div>

      <div style="background: white; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <h3 style="margin-top: 0; color: #2563eb;">Pickup & Delivery</h3>
        <p><strong>Origin:</strong> ${shipmentDetails.originStreet}, ${shipmentDetails.originCity}</p>
        <p><strong>Destination:</strong> ${shipmentDetails.destinationStreet}, ${shipmentDetails.destinationCity}</p>
      </div>

      <div style="text-align: center; margin: 20px 0;">
        <a href="${process.env.FRONTEND_ORIGIN || 'http://localhost:8081'}/admin/shipments"
           style="background: linear-gradient(135deg, #dc2626, #2563eb); color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          View in Admin Portal
        </a>
      </div>

      <p style="margin-bottom: 0; font-size: 14px; color: #64748b;">
        This shipment is now pending and awaits processing. Please review and update the status as needed.
      </p>
    </div>
  </div>
</body>
</html>`;

    const textContent = `New Shipment Created - ${trackingNumber}

A new shipment has been created by ${customerName} and requires your attention.

Shipment Details:
- Tracking Number: ${trackingNumber}
- Customer: ${customerName}
- Description: ${shipmentDetails.description}
- Package Type: ${shipmentDetails.packageType}
- Weight: ${shipmentDetails.weightValue} ${shipmentDetails.weightUnit}
- Value: ${shipmentDetails.value} ${shipmentDetails.currency}
- Priority: ${shipmentDetails.priority}

Pickup & Delivery:
- Origin: ${shipmentDetails.originStreet}, ${shipmentDetails.originCity}
- Destination: ${shipmentDetails.destinationStreet}, ${shipmentDetails.destinationCity}

Please review this shipment in the admin portal and update the status as needed.

RTEXPRESS - Professional Express Delivery Management`;

    // Send email to all admin users
    const emailPromises = adminUsers.map(admin =>
      transporter.sendMail({
        from: SMTP_FROM || SMTP_USER,
        to: admin.email,
        subject: `🚚 New Shipment Created - ${trackingNumber}`,
        text: textContent,
        html,
      })
    );

    await Promise.all(emailPromises);
    console.log(`New shipment email sent to ${adminUsers.length} admin(s) for tracking ${trackingNumber}`);
    return { sent: adminUsers.length };

  } catch (error) {
    console.error('Error sending new shipment email to admins:', error);
    return { error: error.message };
  }
}

// Build title/description for a status event
function getEventMeta(status) {
  switch (status) {
    case 'Ready for Pickup':
      return { title: 'Ready for Pickup', description: 'Shipment is ready for pickup' };
    case 'Picked Up':
      return { title: 'Package Picked Up', description: 'Carrier picked up the package' };
    case 'In Transit':
      return { title: 'In Transit', description: 'Package is moving to the next facility' };
    case 'Out for Delivery':
      return { title: 'Out for Delivery', description: 'Courier is delivering the package' };
    case 'Delivered':
      return { title: 'Delivered', description: 'Package delivered to recipient' };
    case 'Failed Delivery Attempt':
      return { title: 'Delivery Attempted', description: 'Delivery attempt was unsuccessful' };
    case 'Returned to Sender':
      return { title: 'Returned to Sender', description: 'Package returned to sender' };
    case 'Cancelled':
      return { title: 'Shipment Cancelled', description: 'Shipment was cancelled' };
    case 'Lost':
      return { title: 'Package Lost', description: 'Carrier reported the package as lost' };
    case 'Damaged':
      return { title: 'Package Damaged', description: 'Package was damaged in transit' };
    case 'Processing':
      return { title: 'Processing', description: 'Shipment is being processed' };
    case 'Pending':
      return { title: 'Shipment Created', description: 'Shipment record created' };
    default:
      return { title: String(status), description: `${status} update` };
  }
}


router.use(authenticate);

// Test route
router.get('/test', async (req, res) => {
  console.log('Test route reached!');
  res.json({ message: 'Test route working', user: req.user });
});

router.get('/', async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'shipments:read');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }
    const where = user.role === 'CUSTOMER' ? { customer: { ownerId: user.sub } } : {};
    const shipments = await prisma.shipment.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
            phone: true,
            type: true,
          }
        },
        events: { orderBy: { createdAt: 'asc' } }
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(shipments);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch shipments' });
  }
});

// Get shipment by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'shipments:read');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        customer: true,
        events: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Check access permissions for customers
    if (user.role === 'CUSTOMER') {
      const customer = await prisma.customer.findFirst({
        where: { ownerId: user.sub }
      });
      if (!customer || shipment.customerId !== customer.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    await logAudit(req, { action: 'SHIPMENT_STATUS_UPDATE', entityType: 'Shipment', entityId: id, details: { from: existingShipment.status, to: status, actualDelivery: actualDelivery || null } });
    res.json(shipment);

  } catch (error) {
    console.error('Error fetching shipment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update shipment status only
router.patch('/:id/status', requireRole('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actualDelivery } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Validate status
    const validStatuses = [
      'Pending',
      'Processing',
      'Ready for Pickup',
      'Picked Up',
      'In Transit',
      'Out for Delivery',
      'Delivered',
      'Failed Delivery Attempt',
      'Returned to Sender',
      'Cancelled',
      'Lost',
      'Damaged'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Check if shipment exists
    const existingShipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
            phone: true,
            type: true,
            ownerId: true,
          }
        }
      }
    });

    if (!existingShipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Prepare update data
    const updateData = {
      status,
      updatedAt: new Date()
    };

    // Handle actualDelivery date
    if (status === 'Delivered') {
      if (actualDelivery) {
        // Use provided actualDelivery date
        updateData.actualDelivery = new Date(actualDelivery);
      } else {
        // Auto-set to current time if not provided
        updateData.actualDelivery = new Date();
      }
    }

    // Update the shipment status (fast) and return 204 No Content immediately
    await prisma.shipment.update({
      where: { id },
      data: updateData,
      select: { id: true },
    });

    // Some proxies mishandle 204; respond with tiny JSON instead
    res.status(200).json({ ok: true });

    // Fire-and-forget: create status event and send notification (non-blocking)
    setImmediate(async () => {
      try {
        const meta = getEventMeta(status);
        await prisma.shipmentEvent.create({
          data: {
            shipmentId: id,
            status,
            title: meta.title,
            description: meta.description,
          }
        }).catch((err) => {
          console.error('Error creating status event:', err);
        });

        // Fetch minimal fields for notification
        const fresh = await prisma.shipment.findUnique({
          where: { id },
          select: {
            id: true,
            trackingNumber: true,
            customer: { select: { ownerId: true } }
          }
        });

        if (fresh?.customer?.ownerId) {
          await sendShipmentNotification(
            fresh.customer.ownerId,
            fresh.trackingNumber,
            status,
            fresh.id
          );
        }
      } catch (notificationError) {
        console.error('Error in post-update tasks:', notificationError);
      }
    });
  } catch (error) {
    console.error('Error updating shipment status:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    res.status(500).json({ error: 'Failed to update shipment status' });
  }
});

// Delete shipment (admin/staff only)
router.delete('/:id', requireRole('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if shipment exists
    const existingShipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
            phone: true,
            type: true,
            ownerId: true,
          }
        }
      }
    });

    if (!existingShipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Business logic: Only allow deletion for Pending or Processing status
    const allowedStatuses = ['Pending', 'Processing'];
    if (!allowedStatuses.includes(existingShipment.status)) {
      return res.status(400).json({
        error: 'Cannot delete shipment',
        message: `Shipment with status "${existingShipment.status}" cannot be deleted. Only shipments with status "Pending" or "Processing" can be deleted.`
      });
    }

    // Delete the shipment
    await prisma.shipment.delete({
      where: { id }
    });

    // Send notification to customer about shipment deletion
    if (existingShipment.customer?.ownerId) {
      try {
        await sendShipmentNotification(
          existingShipment.customer.ownerId,
          existingShipment.trackingNumber,
          'Cancelled',
          existingShipment.id
        );
      } catch (notificationError) {
        console.error('Error sending deletion notification:', notificationError);
        // Don't fail the request if notification fails
      }
    }

    await logAudit(req, { action: 'SHIPMENT_DELETE', entityType: 'Shipment', entityId: existingShipment.id, details: { trackingNumber: existingShipment.trackingNumber, status: existingShipment.status } });
    res.json({
      message: 'Shipment deleted successfully',
      deletedShipment: {
        id: existingShipment.id,
        trackingNumber: existingShipment.trackingNumber,
        status: existingShipment.status
      }
    });
  } catch (error) {
    console.error('Error deleting shipment:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    res.status(500).json({ error: 'Failed to delete shipment' });
  }
});

// Create shipment
router.post('/', async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid data',
        details: parsed.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    const user = req.user;
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'shipments:create');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }
    const data = parsed.data;

    // RBAC: customer can only create for themselves
    if (user.role === 'CUSTOMER') {
      const customer = await prisma.customer.findFirst({ where: { ownerId: user.sub } });
      if (!customer) return res.status(400).json({ error: 'Customer profile not found' });
      data.customerId = customer.id;
    } else {
      // For admin/staff, customerId is required in the request
      const { customerId } = req.body;
      if (!customerId) {
        return res.status(400).json({ error: 'Customer ID is required' });
      }

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId }
      });

      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      data.customerId = customerId;
    }

    const trackingNumber = await generateNextTrackingNumber();
    const created = await prisma.shipment.create({
      data: { ...data, trackingNumber },
      include: {
        customer: {
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
            phone: true,
            type: true,
          }
        }
      }
    });

    // Initial event
    await prisma.shipmentEvent.create({
      data: {
        shipmentId: created.id,
        status: created.status,
        title: 'Shipment Created',
        description: 'Shipment record created',
      }
    });

    // Send notifications and email to admins for new shipment (only for customer-created shipments)
    if (user.role === 'CUSTOMER') {
      try {
        const customerName = created.customer.companyName ||
                           `${created.customer.firstName} ${created.customer.lastName}`;

        // Send in-app notification to admins
        await sendNewShipmentNotification(customerName, trackingNumber, created.id);

        // Send email notification to admins
        await sendNewShipmentEmailToAdmins(customerName, trackingNumber, {
          description: created.description,
          packageType: created.packageType,
          weightValue: created.weightValue,
          weightUnit: created.weightUnit,
          value: created.value,
          currency: created.currency,
          priority: created.priority,
          originStreet: created.originStreet,
          originCity: created.originCity,
          destinationStreet: created.destinationStreet,
          destinationCity: created.destinationCity
        });

        console.log(`Admin notifications sent for new shipment ${trackingNumber} by customer ${customerName}`);
      } catch (notificationError) {
        console.error('Error sending admin notifications for new shipment:', notificationError);
        // Don't fail the request if notifications fail
      }
    }

    // Return shipment with ordered events
    const full = await prisma.shipment.findUnique({
      where: { id: created.id },
      include: {
        customer: {
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
            phone: true,
            type: true,
          }
        },
        events: { orderBy: { createdAt: 'asc' } }
      }
    });

    await logAudit(req, { action: 'SHIPMENT_CREATE', entityType: 'Shipment', entityId: created.id, details: { trackingNumber, customerId: full.customer?.id } });
    res.status(201).json(full);
  } catch (error) {
    console.error('Error creating shipment:', error);
    if (error.message?.includes('Invalid pickup date') || error.message?.includes('Invalid estimated delivery date')) {
      return res.status(400).json({
        error: 'Invalid date format',
        message: error.message + '. Expected format: YYYY-MM-DDTHH:MM or valid ISO date string.'
      });
    }
    res.status(500).json({ error: 'Internal server error', message: 'Failed to create shipment' });
  }
});

module.exports = { router };
