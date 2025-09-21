import { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import multer from 'multer';
import sanitizeHtml from 'sanitize-html';
import nodemailer from 'nodemailer';

import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { hasPermission } from '../lib/permissions';

export const router = Router();

// Ensure uploads directory exists
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => void 0);

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, UPLOAD_DIR),
  filename: (_req: any, file: any, cb: any) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${unique}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10MB, up to 5 files
});

// Lightweight in-memory rate limiter for abuse protection
const __rateStore = new Map<string, { count: number; resetAt: number }>()
function rateLimit(options: { windowMs: number; max: number; key: (req: any) => string }) {
  return (req: any, res: any, next: any) => {
    const now = Date.now()
    const k = options.key(req)
    const bucket = __rateStore.get(k)
    if (!bucket || bucket.resetAt < now) {
      __rateStore.set(k, { count: 1, resetAt: now + options.windowMs })
      return next()
    }
    bucket.count += 1
    if (bucket.count > options.max) return res.status(429).json({ error: 'Too many requests' })
    next()
  }
}
const limitCreateTicket = rateLimit({ windowMs: 60_000, max: 8, key: (req: any) => (req.user?.sub || req.ip || 'anon') })
const limitReply = rateLimit({ windowMs: 60_000, max: 20, key: (req: any) => (req.user?.sub || req.ip || 'anon') })


router.use(authenticate);

// Schemas
const ticketCreateSchema = z.object({
  subject: z.string().min(3),
  category: z.enum(['billing', 'shipping', 'technical', 'general']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal').optional(),
  descriptionText: z.string().min(1),
  descriptionHtml: z.string().optional(),
});

const kbArticleCreateSchema = z.object({
  title: z.string().min(3),
  category: z.string().optional(),
  contentHtml: z.string().optional(),
  isPublished: z.boolean().optional(),
  tags: z.any().optional(), // JSON array of strings
});

function slugify(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')
}


const messageSchema = z.object({
  bodyText: z.string().min(1).max(20000),
  bodyHtml: z.string().optional(),
  internal: z.boolean().optional(),
});

// Helpers
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

function renderBrandedEmail(brandName: string, subject: string, bodyHtml: string, logoUrl?: string) {
  const safeSubject = subject || 'Support Notification'
  const safeBody = bodyHtml || ''
  const logo = logoUrl ? `<img src="${logoUrl}" alt="${brandName}" style="height:32px;"/>` : `<strong>${brandName}</strong>`
  return `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7f9;padding:24px;">
    <table role="presentation" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#2858B8;color:#fff;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${logo}
            <span style="font-size:14px;opacity:0.9">${brandName} Support</span>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px;">
          <h2 style="margin:0 0 12px 0;color:#111827;font-size:18px;">${safeSubject}</h2>
          <div style="color:#111827;font-size:14px;line-height:1.6;">${safeBody}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
          This is an automated message. Please do not reply directly to this email.
        </td>
      </tr>
    </table>
  </div>`
}


async function sendSupportEmail(to: string, subject: string, html: string, text?: string) {
  const transporter = await getTransporter();
  if (!transporter) return false;
  const { SMTP_FROM, SMTP_USER, APP_NAME, SUPPORT_BRAND_NAME, SUPPORT_BRAND_LOGO_URL } = process.env as any;
  const brand = SUPPORT_BRAND_NAME || APP_NAME || 'RT Express';
  const wrapped = renderBrandedEmail(brand, subject, html, SUPPORT_BRAND_LOGO_URL);
  await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to, subject, html: wrapped, text });
  return true;
}

function cleanHtml(html?: string) {
  if (!html) return undefined;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
      a: ['href', 'name', 'target', 'rel'],
    },
    allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  });
}


// SLA helpers
function getSlaThresholds() {
  const frMin = parseInt((process.env as any).SUPPORT_SLA_FIRST_RESPONSE_MINUTES || '60', 10)
  const resHours = parseInt((process.env as any).SUPPORT_SLA_RESOLUTION_HOURS || '72', 10)
  const warnFactor = parseFloat((process.env as any).SUPPORT_SLA_WARNING_FACTOR || '0.8')
  return { frMin, resHours, warnFactor }
}
function slaStatusForTicket(t: any, nowMs = Date.now()): 'ok' | 'warning' | 'breached' {
  const { frMin, resHours, warnFactor } = getSlaThresholds()
  const created = new Date(t.createdAt).getTime()
  const firstResp = t.firstResponseAt ? new Date(t.firstResponseAt).getTime() : null
  const resolved = t.resolvedAt ? new Date(t.resolvedAt).getTime() : null

  // First response SLA
  const frLimit = frMin * 60 * 1000
  const frWarn = frLimit * warnFactor
  const frAge = (firstResp ?? nowMs) - created
  if (!firstResp) {
    if (frAge > frLimit) return 'breached'
    if (frAge > frWarn) return 'warning'
  }

  // Resolution SLA
  const resLimit = resHours * 3600 * 1000
  const resWarn = resLimit * warnFactor
  const resAge = (resolved ?? nowMs) - created
  if (!resolved && (t.status === 'open' || t.status === 'in_progress')) {
    if (resAge > resLimit) return 'breached'
    if (resAge > resWarn) return 'warning'
  }
  if (resolved) {
    if (resAge > resLimit) return 'breached'
    if (resAge > resWarn) return 'warning'
  }
  return 'ok'
}

// Create a ticket (customer or staff)
router.post('/tickets', limitCreateTicket, upload.array('attachments'), async (req, res) => {
  try {
    const user = (req as any).user;
    const parsed = ticketCreateSchema.parse(req.body);

    // Resolve customer for requester
    let customerId: string | undefined;
    if (user.role === 'CUSTOMER') {
      const cust = await prisma.customer.findFirst({ where: { ownerId: user.sub }, select: { id: true } });
      if (!cust) return res.status(400).json({ error: 'Customer profile not found' });
      customerId = cust.id;
    }

    const files = (req as any).files as any[] | undefined;

    const ticket = await prisma.supportTicket.create({
      data: {
        subject: parsed.subject,
        category: parsed.category,
        priority: parsed.priority ?? 'normal',
        status: 'open',
        customerId,
        requesterUserId: user.sub,
        messages: {
          create: {
            authorUserId: user.sub,
            authorType: user.role === 'CUSTOMER' ? 'customer' : 'staff',
            bodyText: parsed.descriptionText,
            bodyHtml: cleanHtml(parsed.descriptionHtml),
          },
        },
      },
      include: { messages: true },
    });

    // Attachments linked to ticket (and first message if present)
    if (files && files.length) {
      const firstMessage = ticket.messages[0];
      await prisma.supportAttachment.createMany({
        data: files.map((f) => ({
          ticketId: ticket.id,
          messageId: firstMessage?.id,
          filename: f.originalname,
          mimeType: f.mimetype,
          size: f.size,
          storageKey: path.relative(path.resolve(__dirname, '../..'), f.path),
          uploadedByUserId: user.sub,
        })),
      });
    }

    // Auto-assign based on workload if unassigned and staff available
    try {
      if (!ticket.assignedToUserId) {
        const staff = await prisma.user.findMany({
          where: {
            status: 'ACTIVE',
            role: {
              permissions: { some: { permission: { resource: 'support', action: 'update' } } },
            },
          },
          select: { id: true },
        });
        if (staff.length) {
          const staffIds = staff.map((s) => s.id);
          const workload = await prisma.supportTicket.groupBy({
            by: ['assignedToUserId'],
            where: { status: { in: ['open', 'in_progress'] }, assignedToUserId: { in: staffIds } },
            _count: { _all: true },
          });
          const counts = new Map<string, number>();
          staffIds.forEach((id) => counts.set(id, 0));
          workload.forEach((w: any) => {
            if (w.assignedToUserId) counts.set(w.assignedToUserId, w._count._all as number);
          });
          let selected: string | null = null;
          let minCount = Number.POSITIVE_INFINITY;
          for (const id of staffIds) {
            const c = counts.get(id) ?? 0;
            if (c < minCount) { minCount = c; selected = id; }
          }
          if (selected) {
            await prisma.supportTicket.update({ where: { id: ticket.id }, data: { assignedToUserId: selected } });
          }
        }
      }
    } catch (e) {
      console.warn('Auto-assign skipped:', e);
    }

    // Notifications: inform staff and assigned user; ack customer via email (if SMTP configured)
    try {
      const updatedTicket = await prisma.supportTicket.findUnique({ where: { id: ticket.id }, select: { id: true, subject: true, assignedToUserId: true, requesterUserId: true } });
      if (updatedTicket) {
        // WebSocket notify staff roles
        try {
          global.wsManager?.broadcastToRole('ADMIN', { type: 'info', title: 'New Support Ticket', message: updatedTicket.subject, data: { ticketId: updatedTicket.id, event: 'ticket_created' } } as any);
          global.wsManager?.broadcastToRole('MANAGER', { type: 'info', title: 'New Support Ticket', message: updatedTicket.subject, data: { ticketId: updatedTicket.id, event: 'ticket_created' } } as any);
          global.wsManager?.broadcastToRole('STAFF', { type: 'info', title: 'New Support Ticket', message: updatedTicket.subject, data: { ticketId: updatedTicket.id, event: 'ticket_created' } } as any);
          if (updatedTicket.assignedToUserId) {
            global.wsManager?.sendToUser(updatedTicket.assignedToUserId, { type: 'info', title: 'Ticket Assigned', message: updatedTicket.subject, data: { ticketId: updatedTicket.id, event: 'ticket_assigned' } } as any);
          }
        } catch {}
        // Email: notify assignee and acknowledge requester
        try {
          if (updatedTicket.assignedToUserId) {
            const assignee = await prisma.user.findUnique({ where: { id: updatedTicket.assignedToUserId }, select: { email: true, name: true } });
            if (assignee?.email) {
              await sendSupportEmail(assignee.email, `New ticket assigned: ${updatedTicket.subject}`, `<p>You have been assigned a new ticket (#${updatedTicket.id}).</p><p>Subject: <b>${updatedTicket.subject}</b></p>`);
            }
          }
          if (updatedTicket.requesterUserId) {
            const requester = await prisma.user.findUnique({ where: { id: updatedTicket.requesterUserId }, select: { email: true, name: true } });
            if (requester?.email) {
              await sendSupportEmail(requester.email, `We received your ticket: ${updatedTicket.subject}`, `<p>Thanks for contacting support. Your ticket (#${updatedTicket.id}) has been created.</p><p>Subject: <b>${updatedTicket.subject}</b></p>`);
            }
          }
        } catch {}
      }
    } catch {}

    res.status(201).json(ticket);
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors });
    console.error(err);
    res.status(500).json({ error: 'Failed to create support ticket' });
  }
});

// Get current user's tickets (customer) or filtered list (staff)
router.get('/tickets', async (req, res) => {
  try {
    const user = (req as any).user;

    if (user.role === 'CUSTOMER') {
      const tickets = await prisma.supportTicket.findMany({
        where: { requesterUserId: user.sub },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(tickets);
    }

    const ok = await hasPermission(user.sub, 'support:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const { status, priority, category, assigned } = req.query as Record<string, string | undefined>;
    const q = (req.query as any).q ? String((req.query as any).q).trim() : '';

    const page = Math.max(1, parseInt(String((req.query as any).page || '0'), 10) || 0);
    const pageSize = Math.max(1, Math.min(200, parseInt(String((req.query as any).pageSize || '50'), 10)));
    const skip = page > 0 ? (page - 1) * pageSize : undefined;
    const take = page > 0 ? pageSize : undefined;

    const tickets = await prisma.supportTicket.findMany({
      where: {
        status: status || undefined,
        priority: priority || undefined,
        category: category || undefined,
        assignedToUserId: assigned === 'unassigned' ? null : assigned || undefined,
        ...(q ? { OR: [ { subject: { contains: q } }, { messages: { some: { bodyText: { contains: q } } } } ] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    // Optional SLA filter (breached|warning|ok)
    const sla = (req.query as any).sla ? String((req.query as any).sla) : '';
    let rows = tickets;
    if (sla === 'breached' || sla === 'warning' || sla === 'ok') {
      const now = Date.now();
      rows = tickets.filter((t: any) => slaStatusForTicket(t, now) === sla);
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list tickets' });
  }
});

// Get a specific ticket with messages
router.get('/tickets/:id', async (req, res) => {
  try {
    const user = (req as any).user;
    const id = req.params.id;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } }, attachments: true },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    if (user.role === 'CUSTOMER' && ticket.requesterUserId !== user.sub) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // staff must have support:read
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'support:read');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// Add a message (reply). Staff can mark internal.
router.post('/tickets/:id/replies', limitReply, upload.array('attachments'), async (req, res) => {
  try {
    const user = (req as any).user;
    const id = req.params.id;
    const parsed = messageSchema.parse(req.body);

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    if (user.role === 'CUSTOMER' && ticket.requesterUserId !== user.sub) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'support:update');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }

    const files = (req as any).files as any[] | undefined;

    const msg = await prisma.supportMessage.create({
      data: {
        ticketId: id,
        authorUserId: user.sub,
        authorType: user.role === 'CUSTOMER' ? 'customer' : 'staff',
        bodyText: parsed.bodyText,
        bodyHtml: cleanHtml(parsed.bodyHtml),
        internal: user.role !== 'CUSTOMER' ? !!parsed.internal : false,
      },
    });

    if (files && files.length) {
      await prisma.supportAttachment.createMany({
        data: files.map((f) => ({
          ticketId: id,
          messageId: msg.id,
          filename: f.originalname,
          mimeType: f.mimetype,
          size: f.size,
          storageKey: path.relative(path.resolve(__dirname, '../..'), f.path),
          uploadedByUserId: user.sub,
        })),
      });
    }

    // Update ticket timestamps/status heuristics
    await prisma.supportTicket.update({
      where: { id },
      data: { updatedAt: new Date(), firstResponseAt: ticket.firstResponseAt ?? (user.role !== 'CUSTOMER' ? new Date() : ticket.firstResponseAt) },
    });

    // Notifications for replies
    try {
      const t = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, subject: true, assignedToUserId: true, requesterUserId: true } });
      if (t) {
        const isStaffAuthor = user.role !== 'CUSTOMER';
        const isInternal = isStaffAuthor ? !!parsed.internal : false;
        if (isStaffAuthor && !isInternal) {
          // Notify requester
          global.wsManager?.sendToUser(t.requesterUserId!, { type: 'info', title: 'Support Reply', message: t.subject, data: { ticketId: t.id, event: 'ticket_replied' } } as any);
          try {
            const requester = await prisma.user.findUnique({ where: { id: t.requesterUserId! }, select: { email: true } });
            if (requester?.email) await sendSupportEmail(requester.email, `Reply on ticket #${t.id}: ${t.subject}`, `<p>There is a new reply on your ticket.</p>`);
          } catch {}
        } else if (!isStaffAuthor) {
          // Customer replied -> notify assignee or staff roles
          if (t.assignedToUserId) {
            global.wsManager?.sendToUser(t.assignedToUserId, { type: 'info', title: 'Customer replied', message: t.subject, data: { ticketId: t.id, event: 'ticket_customer_replied' } } as any);
            try {
              const assignee = await prisma.user.findUnique({ where: { id: t.assignedToUserId }, select: { email: true } });
              if (assignee?.email) await sendSupportEmail(assignee.email, `Customer replied on ticket #${t.id}`, `<p>Customer replied on: <b>${t.subject}</b></p>`);
            } catch {}
          } else {
            global.wsManager?.broadcastToRole('STAFF', { type: 'info', title: 'Customer replied', message: t.subject, data: { ticketId: t.id, event: 'ticket_customer_replied' } } as any);
            global.wsManager?.broadcastToRole('ADMIN', { type: 'info', title: 'Customer replied', message: t.subject, data: { ticketId: t.id, event: 'ticket_customer_replied' } } as any);
            global.wsManager?.broadcastToRole('MANAGER', { type: 'info', title: 'Customer replied', message: t.subject, data: { ticketId: t.id, event: 'ticket_customer_replied' } } as any);
          }
        }
      }
    } catch {}

    res.status(201).json(msg);
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors });
    console.error(err);
    res.status(500).json({ error: 'Failed to add reply' });
  }
});

// Assign ticket to a staff user
router.put('/admin/tickets/:id/assign', async (req, res) => {
  try {
    const user = (req as any).user;
    const ok = await hasPermission(user.sub, 'support:assign');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const schema = z.object({ assigneeUserId: z.string().nullable() });
    const { assigneeUserId } = schema.parse(req.body);

    const before = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, select: { assignedToUserId: true, subject: true } });
    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { assignedToUserId: assigneeUserId },
    });

    // Notify new assignee
    try {
      if (assigneeUserId && assigneeUserId !== before?.assignedToUserId) {
        global.wsManager?.sendToUser(assigneeUserId, { type: 'info', title: 'Ticket assigned to you', message: before?.subject || 'Support ticket', data: { ticketId: updated.id, event: 'ticket_assigned' } } as any);
        const assignee = await prisma.user.findUnique({ where: { id: assigneeUserId }, select: { email: true } });
        if (assignee?.email) await sendSupportEmail(assignee.email, `Ticket assigned to you: ${before?.subject || updated.id}`, `<p>You have been assigned ticket #${updated.id}.</p>`);
      }
    } catch {}

    res.json(updated);
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors });
    console.error(err);
    res.status(500).json({ error: 'Failed to assign ticket' });
  }
});

// Update ticket status
router.put('/admin/tickets/:id/status', async (req, res) => {
  try {
    const user = (req as any).user;
    const ok = await hasPermission(user.sub, 'support:update');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const schema = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']) });
    const { status } = schema.parse(req.body);

    const updated = await prisma.supportTicket.update({ where: { id: req.params.id }, data: { status } });

    // Notify requester on status changes
    try {
      const t = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, select: { id: true, subject: true, requesterUserId: true } });
      if (t) {
        global.wsManager?.sendToUser(t.requesterUserId!, { type: 'info', title: `Ticket ${status.replace('_',' ')}`, message: t.subject, data: { ticketId: t.id, event: 'ticket_status', status } } as any);
        const requester = await prisma.user.findUnique({ where: { id: t.requesterUserId! }, select: { email: true } });
        if (requester?.email) await sendSupportEmail(requester.email, `Your ticket is now ${status}`, `<p>Status for ticket #${t.id} changed to <b>${status.replace('_',' ')}</b>.</p>`);
      }
    } catch {}

    res.json(updated);
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors });
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Customer satisfaction rating for resolved tickets
router.put('/tickets/:id/satisfaction', async (req, res) => {
  try {
    const user = (req as any).user;
    // Only customers can rate their own tickets
    const schema = z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() });
    const { score, comment } = schema.parse(req.body);

    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    if (ticket.requesterUserId !== user.sub) return res.status(403).json({ error: 'Forbidden' });
    if (ticket.status !== 'resolved') return res.status(400).json({ error: 'Ticket must be resolved before rating' });
    if (ticket.satisfactionScore != null) return res.status(400).json({ error: 'Satisfaction already recorded' });

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { satisfactionScore: score, satisfactionComment: comment ?? null },
    });
    res.json(updated);
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors });
    console.error(err);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// Knowledge Base endpoints
router.get('/kb/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.json([])
    const results = await prisma.supportArticle.findMany({
      where: {
        isPublished: true,
        OR: [
          { title: { contains: q } },
          { contentText: { contains: q } },
          { category: { contains: q } },
        ],
      },
      select: { id: true, title: true, category: true },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    })
    res.json(results)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to search articles' })
  }
})

router.get('/kb', async (_req, res) => {
  try {
    const list = await prisma.supportArticle.findMany({
      where: { isPublished: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, category: true },
      take: 50,
    })
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list articles' })
  }
})

router.get('/kb/:id', async (req, res) => {
  try {
    const art = await prisma.supportArticle.findFirst({
      where: { id: req.params.id, isPublished: true },
    })
    if (!art) return res.status(404).json({ error: 'Not found' })
    res.json(art)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch article' })
  }
})

router.get('/admin/kb', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:manage')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const list = await prisma.supportArticle.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, category: true, isPublished: true, updatedAt: true, createdAt: true },
      take: 200,
    })
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list articles' })
  }
})


router.post('/admin/kb', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:manage')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const parsed = kbArticleCreateSchema.parse(req.body)
    const html = cleanHtml(parsed.contentHtml)
    const text = html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null

    const created = await prisma.supportArticle.create({
      data: {
        title: parsed.title,
        slug: slugify(parsed.title),
        category: parsed.category ?? null,
        contentHtml: html ?? null,
        contentText: text,
        tags: parsed.tags ?? undefined,
        isPublished: parsed.isPublished ?? true,
        createdByUserId: user.sub,
      },
    })
    res.status(201).json(created)
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors })
    console.error(err)
    res.status(500).json({ error: 'Failed to create article' })
  }
})

router.put('/admin/kb/:id', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:manage')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const parsed = kbArticleCreateSchema.partial().parse(req.body)
    const html = parsed.contentHtml !== undefined ? cleanHtml(parsed.contentHtml) : undefined
    const text = html !== undefined ? (html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null) : undefined



    const updated = await prisma.supportArticle.update({
      where: { id: req.params.id },
      data: {
        title: parsed.title,
        slug: parsed.title ? slugify(parsed.title) : undefined,
        category: parsed.category ?? undefined,
        contentHtml: html,
        contentText: text,
        tags: parsed.tags,
        isPublished: parsed.isPublished,
      },
    })
    res.json(updated)
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors })
    console.error(err)
    res.status(500).json({ error: 'Failed to update article' })
  }
})



// Canned responses (admin)
const cannedSchema = z.object({
  title: z.string().min(2),
  contentHtml: z.string().optional(),
  contentText: z.string().optional(),
  category: z.string().optional(),
})

router.get('/admin/canned-responses', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:manage')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const list = await prisma.supportCannedResponse.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, category: true, contentHtml: true, contentText: true, updatedAt: true },
      take: 200,
    })
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list canned responses' })
  }
})

router.post('/admin/canned-responses', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:manage')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const parsed = cannedSchema.parse(req.body)
    const html = cleanHtml(parsed.contentHtml)
    const text = parsed.contentText ?? (html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null)

    const created = await prisma.supportCannedResponse.create({
      data: {
        title: parsed.title,
        category: parsed.category ?? null,
        contentHtml: html ?? null,
        contentText: text ?? null,
        createdByUserId: user.sub,
      },
    })
    res.status(201).json(created)
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors })
    console.error(err)
    res.status(500).json({ error: 'Failed to create canned response' })
  }
})

router.put('/admin/canned-responses/:id', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:manage')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const parsed = cannedSchema.partial().parse(req.body)
    const html = parsed.contentHtml !== undefined ? cleanHtml(parsed.contentHtml) : undefined
    const text = parsed.contentText !== undefined ? parsed.contentText : (html !== undefined ? (html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null) : undefined)

    const updated = await prisma.supportCannedResponse.update({
      where: { id: req.params.id },
      data: {
        title: parsed.title,
        category: parsed.category ?? undefined,
        contentHtml: html,
        contentText: text as any,
      },
    })
    res.json(updated)
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors })
    console.error(err)
    res.status(500).json({ error: 'Failed to update canned response' })
  }
})

router.delete('/admin/canned-responses/:id', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:manage')

    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    await prisma.supportCannedResponse.delete({ where: { id: req.params.id } })
    res.status(204).end()
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    console.error(err)

    res.status(500).json({ error: 'Failed to delete canned response' })
  }
})


// Admin metrics
router.get('/admin/metrics', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:read')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const tickets = await prisma.supportTicket.findMany({
      select: { status: true, priority: true, createdAt: true, firstResponseAt: true, resolvedAt: true, satisfactionScore: true }
    })
    const counts: any = { open: 0, in_progress: 0, resolved: 0, closed: 0 }
    let respSumMin = 0, respCount = 0
    let resSumHr = 0, resCount = 0
    let satSum = 0, satCount = 0
    for (const t of tickets) {
      counts[t.status] = (counts[t.status] || 0) + 1
      if (t.firstResponseAt) {
        respSumMin += (t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60000
        respCount++
      }
      if (t.resolvedAt) {
        resSumHr += (t.resolvedAt.getTime() - t.createdAt.getTime()) / 3600000
        resCount++
      }
      if (t.satisfactionScore != null) {
        satSum += t.satisfactionScore
        satCount++
      }

// Trends: tickets created per day for last N days
router.get('/admin/metrics/trend', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:read')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const days = Math.max(1, Math.min(180, parseInt(String((req.query as any).days || '30'), 10)))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const list = await prisma.supportTicket.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } })

    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const buckets: Record<string, number> = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      buckets[fmt(d)] = 0
    }
    for (const t of list) {
      const key = fmt(new Date(t.createdAt))
      if (key in buckets) buckets[key]++
    }
    const data = Object.entries(buckets).map(([date, created]) => ({ date, created }))
    res.json({ days, data })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to load trend' })
  }
})

    }
    res.json({
      counts,
      avgFirstResponseMinutes: respCount ? Math.round((respSumMin / respCount) * 10) / 10 : 0,
      avgResolutionHours: resCount ? Math.round((resSumHr / resCount) * 10) / 10 : 0,
      avgSatisfaction: satCount ? Math.round((satSum / satCount) * 10) / 10 : null,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to load metrics' })
  }
})

// Export tickets CSV

// Inbound email webhook status
router.get('/admin/inbound-status', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:read')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })
    res.json({ enabled: !!process.env.SUPPORT_INBOUND_SECRET })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to load inbound status' })
  }
})

router.get('/admin/tickets/export', async (req, res) => {
  try {
    const user = (req as any).user
    const ok = await hasPermission(user.sub, 'support:read')
    if (!ok) return res.status(403).json({ error: 'Forbidden' })

    const { status, priority, category, assigned } = req.query as Record<string, string | undefined>
    const q = (req.query as any).q ? String((req.query as any).q).trim() : ''
    const sla = (req.query as any).sla ? String((req.query as any).sla) : ''

    const list = await prisma.supportTicket.findMany({
      where: {
        status: status || undefined,
        priority: priority || undefined,
        category: category || undefined,
        assignedToUserId: assigned === 'unassigned' ? null : assigned || undefined,
        ...(q ? { OR: [ { subject: { contains: q } }, { messages: { some: { bodyText: { contains: q } } } } ] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, subject: true, status: true, priority: true, category: true, createdAt: true, updatedAt: true, assignedToUserId: true, satisfactionScore: true, firstResponseAt: true, resolvedAt: true }
    })

    const listFiltered = (sla === 'breached' || sla === 'warning' || sla === 'ok') ? list.filter((t:any) => slaStatusForTicket(t) === sla) : list

    const rows = [
      ['id','subject','status','priority','category','createdAt','updatedAt','assignedToUserId','satisfactionScore'],
      ...listFiltered.map(t => [
        t.id,
        (t.subject || '').replace(/"/g,'""'),
        t.status,
        t.priority,
        t.category,
        t.createdAt.toISOString(),
        t.updatedAt?.toISOString?.() || '',
        t.assignedToUserId || '',
        t.satisfactionScore != null ? String(t.satisfactionScore) : ''
      ])
    ]
    const csv = rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v)}"` : String(v)).join(',')).join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"')
    res.send(csv)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to export tickets' })
  }
})


// Inbound email webhook (shared secret)
const inboundSchema = z.object({
  from: z.string().email(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyToTicketId: z.string().optional(),
})

router.post('/inbound-email', async (req, res) => {
  try {
    const secret = (process.env as any).SUPPORT_INBOUND_SECRET
    if (!secret) return res.status(503).json({ error: 'Inbound not configured' })
    if (req.headers['x-inbound-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' })

    const parsed = inboundSchema.parse(req.body)
    const sender = await prisma.user.findFirst({ where: { email: parsed.from }, select: { id: true } })
    if (!sender) return res.status(400).json({ error: 'Unknown sender' })

    const isStaff = await hasPermission(sender.id, 'support:update')

    const cleanBodyHtml = cleanHtml(parsed.html)
    const bodyText = (parsed.text || (cleanBodyHtml ? cleanBodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '')).slice(0, 20000)

    if (parsed.inReplyToTicketId) {
      const ticket = await prisma.supportTicket.findUnique({ where: { id: parsed.inReplyToTicketId } })
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
      // Only requester can reply by email, or any staff (admin/manager/staff with support:update)
      let allowed = ticket.requesterUserId === sender.id
      if (!allowed) allowed = await hasPermission(sender.id, 'support:update')
      if (!allowed) return res.status(403).json({ error: 'Forbidden' })

      const msg = await prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          authorUserId: sender.id,
          authorType: isStaff ? 'staff' : 'customer',
          bodyText,
          bodyHtml: cleanBodyHtml,
          internal: false,
        }
      })
      await prisma.supportTicket.update({ where: { id: ticket.id }, data: { updatedAt: new Date(), firstResponseAt: ticket.firstResponseAt ?? (isStaff ? new Date() : ticket.firstResponseAt) } })
      return res.status(201).json({ ok: true, ticketId: ticket.id, messageId: msg.id })
    }

    // Create new ticket from email
    let customerId: string | undefined = undefined
    {
      const cust = await prisma.customer.findFirst({ where: { ownerId: sender.id }, select: { id: true } })
      customerId = cust?.id
    }
    const subject = (parsed.subject || 'Support request').slice(0, 200)
    const created = await prisma.supportTicket.create({
      data: {
        subject,
        category: 'general',
        priority: 'normal',
        status: 'open',
        customerId,
        requesterUserId: sender.id,
        messages: { create: { authorUserId: sender.id, authorType: isStaff ? 'staff' : 'customer', bodyText, bodyHtml: cleanBodyHtml } }
      },
      select: { id: true }
    })
    res.status(201).json({ ok: true, ticketId: created.id })
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', details: err.errors })
    console.error(err)
    res.status(500).json({ error: 'Inbound processing failed' })
  }
})


