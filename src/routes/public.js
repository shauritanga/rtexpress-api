const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// Generate unique request number
async function generateRequestNumber() {
  const year = new Date().getFullYear();
  const prefix = `BR${year}`;

  // Find the highest existing request number for this year by looking at IDs
  const lastRequest = await prisma.bookingRequest.findFirst({
    where: {
      id: {
        startsWith: prefix
      }
    },
    orderBy: {
      id: 'desc'
    }
  });

  let nextNumber = 1;
  if (lastRequest) {
    // Extract the number part and increment
    const lastNumber = parseInt(lastRequest.id.replace(prefix, ''));
    nextNumber = lastNumber + 1;
  }

  // Format with leading zeros (e.g., BR2025001, BR2025002, etc.)
  return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
}


const router = Router();

// Public booking request — CSRF + create + notify
const bookingSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  phone: z.string().trim().min(6, 'Phone is required').max(32),
  email: z.string().trim().email('Valid email is required').max(160),
  itemDescription: z.string().trim().min(1, 'Item description is required').max(1000),
  pickupLocation: z.string().trim().min(1, 'Pickup location is required').max(255),
  deliveryLocation: z.string().trim().min(1, 'Delivery location is required').max(255),
  notes: z.string().trim().max(1000).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
});

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: (SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

const publicBookingLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.PUBLIC_BOOKING_RATE_LIMIT || 20) });

// Lightweight CSRF token for public booking
router.get('/csrf', (req, res) => {
  try {
    const secret = process.env.JWT_ACCESS_SECRET || 'dev-secret';
    const token = jwt.sign({ purpose: 'public-booking' }, secret, { expiresIn: '30m' });
    return res.json({ token });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to issue CSRF token' });
  }
});

router.post('/booking-request', publicBookingLimiter, async (req, res) => {
  try {
    const csrfMode = String(process.env.PUBLIC_CSRF || 'on').toLowerCase();
    if (!['off','0','false','no'].includes(csrfMode)) {
      const token = req.header('x-csrf-token');
      if (!token) return res.status(403).json({ error: 'Missing CSRF token' });
      try {
        const secret = process.env.JWT_ACCESS_SECRET || 'dev-secret';
        const dec = jwt.verify(String(token), secret);
        if (!dec || dec.purpose !== 'public-booking') return res.status(403).json({ error: 'Invalid CSRF token' });
      } catch {
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
    }

    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
    }

    // Generate unique request number to use as ID
    const requestNumber = await generateRequestNumber();

    const created = await prisma.bookingRequest.create({
      data: {
        id: requestNumber, // Use request number as the primary ID
        ...parsed.data,
        consentAt: new Date()
      }
    });

    // Notify admins via email (if SMTP configured)
    try {
      const transporter = getTransporter();
      if (transporter) {
        const ackOn = String(process.env.PUBLIC_BOOKING_ACK || 'on').toLowerCase();
        const admins = await prisma.user.findMany({
          where: { role: { name: { in: ['ADMIN', 'MANAGER', 'STAFF'] } } },
          select: { email: true, name: true },
        });
        const to = admins.map(a => a.email).filter(Boolean).join(',');
        if (to) {
          const subject = `New Booking Request ${created.id} from ${created.fullName}`;
          const lines = [
            `Request Number: ${created.id}`,
            `Name: ${created.fullName}`,
            `Email: ${created.email}`,
            `Phone: ${created.phone}`,
            `Pickup: ${created.pickupLocation}`,
            `Delivery: ${created.deliveryLocation}`,
            `Item: ${created.itemDescription}`,
            `Notes: ${created.notes || '-'}`,
            `Status: ${created.status}`,
            `Received: ${created.createdAt.toISOString()}`,
          ].join('\n');
          const html = `<!doctype html><html><body style="font-family:Arial,sans-serif">`
            + `<h2>New Booking Request ${created.id}</h2>`
            + `<p>A new booking request has been submitted.</p>`
            + `<ul>`
            + `<li><strong>Request Number:</strong> ${created.id}</li>`
            + `<li><strong>Name:</strong> ${created.fullName}</li>`
            + `<li><strong>Email:</strong> ${created.email}</li>`
            + `<li><strong>Phone:</strong> ${created.phone}</li>`
            + `<li><strong>Pickup:</strong> ${created.pickupLocation}</li>`
            + `<li><strong>Delivery:</strong> ${created.deliveryLocation}</li>`
            + `<li><strong>Item:</strong> ${created.itemDescription}</li>`
            + `<li><strong>Notes:</strong> ${created.notes || '-'}</li>`
            + `</ul>`
            + `</body></html>`;
          const { SMTP_FROM, SMTP_USER } = process.env;
          await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to, subject, text: lines, html });
          if (!['off','0','false','no'].includes(ackOn)) {
            const ackSubject = 'We received your shipment request';
            const ackText = `Hi ${created.fullName},\n\nThank you for your request. Your reference number is ${created.id}. Our team will contact you shortly.\n\n— RT Express Team`;
            try { await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to: created.email, subject: ackSubject, text: ackText }); } catch {}
          }
        }
      }
    } catch (e) {
      console.error('Booking email notify error', e);
    }

    res.status(201).json({ ok: true, id: created.id });
  } catch (error) {
    console.error('Create public booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public tracking endpoint
router.get('/track/:trackingNumber', async (req, res) => {
  try {
    const { trackingNumber } = req.params;

    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber },
      include: {
        events: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    res.json({
      trackingNumber: shipment.trackingNumber,
      status: shipment.status,
      originCity: shipment.originCity,
      destCity: shipment.destCity,
      estimatedDelivery: shipment.estimatedDelivery,
      actualDelivery: shipment.actualDelivery,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
      events: (shipment.events || []).map((e) => ({ id: e.id, title: e.title || e.status, description: e.description || undefined, timestamp: e.createdAt, location: e.location || undefined }))
    });

  } catch (error) {
    console.error('Error tracking shipment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public contact form
const contactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  subject: z.string().min(1),
  message: z.string().min(1),
});

router.post('/contact', async (req, res) => {
  try {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
    }

    const { name, email, subject, message } = parsed.data;

    // Create a support ticket for the contact form
    const ticket = await prisma.supportTicket.create({
      data: {
        subject: `Contact Form: ${subject}`,
        description: `From: ${name} (${email})\n\n${message}`,
        priority: 'NORMAL',
        status: 'open',
        category: 'contact_form',
        // Note: requesterUserId is optional for public contact forms
      }
    });

    res.status(201).json({
      message: 'Contact form submitted successfully',
      ticketId: ticket.id,
    });

  } catch (error) {
    console.error('Error submitting contact form:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router };
