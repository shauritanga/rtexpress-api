const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();
const publicPaymentsRouter = Router();

router.use(authenticate);

// Get payments
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const { page = '1', limit = '10', search, status } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let where = {};

    // Customer can only see their own payments
    if (user.role === 'CUSTOMER') {
      const customer = await prisma.customer.findFirst({
        where: { ownerId: user.sub }
      });
      if (!customer) {
        return res.status(404).json({ error: 'Customer profile not found' });
      }
      where.invoice = { customerId: customer.id };
    }

    if (search) {
      where.OR = [
        { transactionId: { contains: search, mode: 'insensitive' } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          invoice: {
            include: {
              customer: {
                select: {
                  id: true,
                  customerNumber: true,
                  firstName: true,
                  lastName: true,
                  companyName: true,
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limitNum,
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({
      payments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });

  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get payment by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: {
          include: {
            customer: true,
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Check access permissions
    if (user.role === 'CUSTOMER') {
      const customer = await prisma.customer.findFirst({
        where: { ownerId: user.sub }
      });
      if (!customer || payment.invoice.customerId !== customer.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(payment);

  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public webhook endpoint for payment notifications
publicPaymentsRouter.post('/webhook', async (req, res) => {
  try {
    // Basic webhook handler - implement according to payment provider
    console.log('Payment webhook received:', req.body);
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing payment webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, publicPaymentsRouter };
