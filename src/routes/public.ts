import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';

export const router = Router();

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

async function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env as any;
  if (!SMTP_HOST || !SMTP_PORT) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

const publicBookingLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.PUBLIC_BOOKING_RATE_LIMIT || 20) });

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
    // Lightweight anti-forgery token (since this endpoint is unauthenticated)
    const csrfMode = String(process.env.PUBLIC_CSRF || 'on').toLowerCase();
    if (!['off','0','false','no'].includes(csrfMode)) {
      const token = req.header('x-csrf-token');
      if (!token) return res.status(403).json({ error: 'Missing CSRF token' });
      try {
        const secret = process.env.JWT_ACCESS_SECRET || 'dev-secret';
        const dec: any = jwt.verify(String(token), secret);
        if (dec?.purpose !== 'public-booking') return res.status(403).json({ error: 'Invalid CSRF token' });
      } catch {
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
    }

    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
    }

    const created = await (prisma as any).bookingRequest.create({ data: { ...parsed.data, consentAt: new Date() } });

    // Notify admins via email (if SMTP configured)
    try {
      const transporter = await getTransporter();
      if (transporter) {
        const ackOn = String(process.env.PUBLIC_BOOKING_ACK || 'on').toLowerCase();
        const admins = await (prisma as any).user.findMany({
          where: { role: { name: { in: ['ADMIN', 'MANAGER', 'STAFF'] } } as any },
          select: { email: true, name: true },
        });
        const to = (admins as any[]).map((a: any) => a.email).filter(Boolean).join(',');
        if (to) {
          const subject = `New Booking Request from ${created.fullName}`;
          const lines = [
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
          const html = `<!doctype html><html><body style="font-family:Arial,sans-serif">`+
            `<h2>New Booking Request</h2>`+
            `<p>A new booking request has been submitted.</p>`+
            `<ul>`+
            `<li><strong>Name:</strong> ${created.fullName}</li>`+
            `<li><strong>Email:</strong> ${created.email}</li>`+
            `<li><strong>Phone:</strong> ${created.phone}</li>`+
            `<li><strong>Pickup:</strong> ${created.pickupLocation}</li>`+
            `<li><strong>Delivery:</strong> ${created.deliveryLocation}</li>`+
            `<li><strong>Item:</strong> ${created.itemDescription}</li>`+
            `<li><strong>Notes:</strong> ${created.notes || '-'}</li>`+
            `</ul>`+
            `</body></html>`;
          const { SMTP_FROM, SMTP_USER } = process.env as any;
          await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to, subject, text: lines, html });
          // Acknowledge requester
          if (!['off','0','false','no'].includes(ackOn)) {
            const ackSubject = 'We received your shipment request';
            const ackText = `Hi ${created.fullName},\n\nThank you for your request. Your reference ID is ${created.id}. Our team will contact you shortly.\n\n— RT Express Team`;
            try { await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to: created.email, subject: ackSubject, text: ackText }); } catch {}
          }
        }
      }
    } catch (e) {
      console.error('Booking email notify error', e);
    }

    res.status(201).json({ ok: true, id: created.id });
  } catch (error: any) {
    console.error('Create public booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

