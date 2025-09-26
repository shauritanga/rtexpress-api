const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');

const router = Router();

const createTicketSchema = z.object({
  subject: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  category: z.string().optional(),
});

router.use(authenticate);

// Get current user's tickets (customer) or filtered list (staff)
router.get('/tickets', async (req, res) => {
  try {
    const user = req.user;

    if (user.role === 'CUSTOMER') {
      const tickets = await prisma.supportTicket.findMany({
        where: { requesterUserId: user.sub },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(tickets);
    }

    const ok = await hasPermission(user.sub, 'support:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const { status, priority, category, assigned } = req.query;
    const q = req.query.q ? String(req.query.q).trim() : '';

    const page = Math.max(1, parseInt(String(req.query.page || '0'), 10) || 0);
    const pageSize = Math.max(1, Math.min(200, parseInt(String(req.query.pageSize || '50'), 10)));
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

    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list tickets' });
  }
});

// Create support ticket
router.post('/tickets', async (req, res) => {
  try {
    const parsed = createTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
    }

    const data = parsed.data;
    const user = req.user;

    const ticket = await prisma.supportTicket.create({
      data: {
        ...data,
        requesterUserId: user.sub,
        status: 'open',
      },
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    });

    res.status(201).json(ticket);

  } catch (error) {
    console.error('Error creating support ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get ticket by ID
router.get('/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        attachments: true
      },
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Support ticket not found' });
    }

    // Check access permissions
    if (user.role === 'CUSTOMER' && ticket.requesterUserId !== user.sub) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(ticket);

  } catch (error) {
    console.error('Error fetching support ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router };
