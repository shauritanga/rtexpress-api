import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hasPermission } from '../lib/permissions';
import { authenticate, requireRole } from '../middleware/auth';
import { sendShipmentNotification } from '../lib/notifications';

export const router = Router();

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
const dateTransform = (fieldName: string) => z.string().optional().transform((val) => {
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

const updateSchema = z.object({
  description: z.string().min(1).optional(),
  packageType: z.string().min(1).optional(),
  weightValue: z.number().positive().optional(),
  weightUnit: z.string().min(1).optional(),
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  dimensionUnit: z.string().optional(),
  value: z.number().positive().optional(),
  currency: z.string().optional(),
  priority: Priority.optional(),
  status: ShipmentStatus.optional(),
  originStreet: z.string().min(1).optional(),
  originCity: z.string().min(1).optional(),
  originState: z.string().min(1).optional(),
  originZip: z.string().min(1).optional(),
  originCountry: z.string().min(1).optional(),
  destStreet: z.string().min(1).optional(),
  destCity: z.string().min(1).optional(),
  destState: z.string().min(1).optional(),
  destZip: z.string().min(1).optional(),
  destCountry: z.string().min(1).optional(),
  pickupDate: dateTransform('pickup date'),
  estimatedDelivery: dateTransform('estimated delivery date'),
  actualDelivery: dateTransform('actual delivery date'),
  insuranceValue: z.number().nonnegative().optional(),
  signatureRequired: z.boolean().optional(),
});

const statusUpdateSchema = z.object({
  status: ShipmentStatus,
  actualDelivery: dateTransform('actual delivery date'),
});


async function generateNextTrackingNumber(): Promise<string> {
  const prefix = '0255';
  // Find the current max tracking number starting with 0255
  const last = await prisma.shipment.findMany({
    select: { trackingNumber: true },
    where: { trackingNumber: { startsWith: prefix } as any },
    orderBy: { trackingNumber: 'desc' as any },
    take: 1,
  });
  const current = last[0]?.trackingNumber;
  const currentNum = current && current.startsWith(prefix) ? parseInt(current.slice(prefix.length), 10) : 0;
  const nextNum = isNaN(currentNum) ? 1 : currentNum + 1;
  const suffix = String(nextNum).padStart(8, '0');
  return prefix + suffix;
}



router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'shipments:read');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }
    const where: any = user.role === 'CUSTOMER' ? { customer: { ownerId: user.sub } } : {};
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
        }
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(shipments);
  } catch (error: any) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch shipments' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    if ((req as any).user.role !== 'CUSTOMER') {
      const ok = await hasPermission((req as any).user.sub, 'shipments:read');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }


    const shipment = await prisma.shipment.findUnique({
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
          }
        }
      }
    });

    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // If customer, ensure ownership
    if (user.role === 'CUSTOMER') {
      const owns = await prisma.shipment.findFirst({
        where: { id, customer: { ownerId: user.sub } }
      });
      if (!owns) {
        return res.status(403).json({ error: 'Forbidden', message: 'Access denied to this shipment' });
      }
    }

    res.json(shipment);
  } catch (error: any) {
    console.error('Error fetching shipment:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch shipment' });
  }
});

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

    const user = (req as any).user;
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'shipments:create');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }
    const data = parsed.data as any;

    // RBAC: customer can only create for themselves
    if (user.role === 'CUSTOMER') {
      const customer = await prisma.customer.findFirst({ where: { ownerId: user.sub } });
      if (!customer) return res.status(400).json({ error: 'Customer profile not found' });
      data.customerId = customer.id;
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
    res.status(201).json(created);
  } catch (error: any) {
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

// Update shipment status only
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;

    const user = (req as any).user;
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'shipments:status_update');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid data',
        details: parsed.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    // If customer, ensure ownership and restrict status changes
    if (user.role === 'CUSTOMER') {
      const owns = await prisma.shipment.findFirst({ where: { id, customer: { ownerId: user.sub } } });
      if (!owns) return res.status(403).json({ error: 'Forbidden' });
      // Customers can only cancel their shipments
      if (parsed.data.status !== 'Cancelled') {
        return res.status(403).json({ error: 'Customers can only cancel shipments' });
      }
    }

    const data = parsed.data as any;

    // Auto-set actualDelivery date when status is "Delivered"
    if (data.status === 'Delivered' && !data.actualDelivery) {
      data.actualDelivery = new Date().toISOString();
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data,
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

    // Send notification to customer about status update
    if (updated.customer?.ownerId) {
      await sendShipmentNotification(
        updated.customer.ownerId,
        updated.trackingNumber,
        data.status,
        updated.id
      );
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating shipment status:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    if (error.message?.includes('Invalid')) {
      return res.status(400).json({
        error: 'Invalid date format',
        message: error.message + '. Expected format: YYYY-MM-DDTHH:MM or valid ISO date string.'
      });
    }
    res.status(500).json({ error: 'Internal server error', message: 'Failed to update shipment status' });
  }
});

// Update shipment details
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'shipments:update');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }


    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid data',
        details: parsed.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    // If customer, ensure ownership and limit what they can edit
    if (user.role === 'CUSTOMER') {
      const owns = await prisma.shipment.findFirst({ where: { id, customer: { ownerId: user.sub } } });
      if (!owns) return res.status(403).json({ error: 'Forbidden' });

      // Customers can only update certain fields before pickup
      const shipment = await prisma.shipment.findUnique({ where: { id } });
      if (shipment && !['Processing', 'Ready for Pickup'].includes(shipment.status)) {
        return res.status(403).json({
          error: 'Cannot edit shipment',
          message: 'Shipments can only be edited before pickup'
        });
      }

      // Limit fields customers can edit
      const allowedFields = ['description', 'value', 'insuranceValue', 'signatureRequired'];
      const submittedFields = Object.keys(parsed.data);
      const unauthorizedFields = submittedFields.filter(field => !allowedFields.includes(field));

      if (unauthorizedFields.length > 0) {
        return res.status(403).json({
          error: 'Unauthorized fields',
          message: `Customers can only edit: ${allowedFields.join(', ')}`
        });
      }
    }

    const data = parsed.data as any;

    // Auto-set actualDelivery date when status is "Delivered"
    if (data.status === 'Delivered' && !data.actualDelivery) {
      data.actualDelivery = new Date().toISOString();
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data,
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
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating shipment:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    if (error.message?.includes('Invalid')) {
      return res.status(400).json({
        error: 'Invalid date format',
        message: error.message + '. Expected format: YYYY-MM-DDTHH:MM or valid ISO date string.'
      });
    }
    res.status(500).json({ error: 'Internal server error', message: 'Failed to update shipment' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'shipments:delete');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }


    if (user.role === 'CUSTOMER') {
      const owns = await prisma.shipment.findFirst({ where: { id, customer: { ownerId: user.sub } } });
      if (!owns) return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.shipment.delete({ where: { id } });
    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting shipment:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    res.status(500).json({ error: 'Internal server error', message: 'Failed to delete shipment' });
  }
});

