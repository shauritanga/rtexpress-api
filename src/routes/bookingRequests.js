const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');
const { sendBookingNotification } = require('../lib/notifications');
const { logAudit } = require('../lib/audit');

const router = Router();

router.use(authenticate);

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  status: z.string().optional(),
});

router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const ok = await hasPermission(user.sub, 'bookings:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const { page, pageSize, search, status } = listSchema.parse(req.query);

    const where = {};
    if (status && status !== 'all') where.status = status;
    if (search) {
      const q = search.trim();
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { pickupLocation: { contains: q, mode: 'insensitive' } },
        { deliveryLocation: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.bookingRequest.count({ where }),
      prisma.bookingRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
    ]);
    res.json({ page, pageSize, total, items });
  } catch (error) {
    console.error('List booking requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const statusSchema = z.object({ status: z.enum(['pending','confirmed','rejected','completed','converted']) });
router.patch('/:id/status', async (req, res) => {
  try {
    const user = req.user;
    const ok = await hasPermission(user.sub, 'bookings:update');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const id = req.params.id;
    const { status } = statusSchema.parse(req.body);
    const updated = await prisma.bookingRequest.update({ where: { id }, data: { status } });

    // Send notification about booking status update
    // Note: BookingRequest doesn't have a direct user relationship, so we'll send to admins
    // In a real implementation, you might want to store the user who created the booking
    if (status === 'confirmed' || status === 'rejected' || status === 'completed') {
      // For now, we'll just log this. In production, you'd want to track the user who made the booking
      console.log(`Booking ${id} status updated to ${status} - notification would be sent to requester`);
    }

    await logAudit(req, { action: 'BOOKING_STATUS_UPDATE', entityType: 'BookingRequest', entityId: id, details: { to: status } });
    res.json(updated);
  } catch (error) {
    console.error('Update booking status error:', error);
    if (error.code === 'P2025') return res.status(404).json({ error: 'Booking request not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert to shipment: requires an existing customerId and structured addresses in body
const convertSchema = z.object({
  customerId: z.string(),
  packageType: z.string().default('Package'),
  weightValue: z.number().positive().default(1),
  weightUnit: z.string().default('kg'),
  value: z.number().nonnegative().default(0),
  currency: z.string().default('TZS'),
  priority: z.string().default('medium'),
  originStreet: z.string(),
  originCity: z.string(),
  originState: z.string(),
  originZip: z.string(),
  originCountry: z.string(),
  destStreet: z.string(),
  destCity: z.string(),
  destState: z.string(),
  destZip: z.string(),
  destCountry: z.string(),
});

router.post('/:id/convert-to-shipment', async (req, res) => {
  try {
    const user = req.user;
    const ok = await hasPermission(user.sub, 'shipments:create');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const id = req.params.id;
    const booking = await prisma.bookingRequest.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: 'Booking request not found' });

    const data = convertSchema.parse(req.body);

    // Generate next tracking number like shipments route
    async function generateNextTrackingNumber() {
      const prefix = '0255';
      const last = await prisma.shipment.findMany({
        select: { trackingNumber: true },
        where: { trackingNumber: { startsWith: prefix } },
        orderBy: { trackingNumber: 'desc' },
        take: 1
      });
      const nextNum = last[0] ? String(Number(last[0].trackingNumber) + 1) : prefix + '0000001';
      return nextNum;
    }

    const trackingNumber = await generateNextTrackingNumber();

    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber,
        customerId: data.customerId,
        description: booking.itemDescription,
        packageType: data.packageType,
        weightValue: data.weightValue,
        weightUnit: data.weightUnit,
        length: null,
        width: null,
        height: null,
        dimensionUnit: null,
        value: data.value,
        currency: data.currency,
        priority: data.priority,
        status: 'Processing',
        originStreet: data.originStreet,
        originCity: data.originCity,
        originState: data.originState,
        originZip: data.originZip,
        originCountry: data.originCountry,
        destStreet: data.destStreet,
        destCity: data.destCity,
        destState: data.destState,
        destZip: data.destZip,
        destCountry: data.destCountry,
      },
    });

    await prisma.bookingRequest.update({ where: { id }, data: { status: 'converted' } });

    await logAudit(req, { action: 'BOOKING_CONVERT_TO_SHIPMENT', entityType: 'BookingRequest', entityId: id, details: { shipmentId: shipment.id, trackingNumber } });

    res.status(201).json({ ok: true, shipmentId: shipment.id, trackingNumber });
  } catch (error) {
    console.error('Convert booking to shipment error:', error);
    if (error.code === 'P2025') return res.status(404).json({ error: 'Booking request not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router };
