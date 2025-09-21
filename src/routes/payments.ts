import express, { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { hasPermission } from '../lib/permissions';
import { authenticate } from '../middleware/auth';

export const router = Router();

// Authenticated routes
router.use(authenticate);




// ClickPesa initiation (server-side)
const initSchema = z.object({
  invoiceId: z.string(),
  amount: z.number().positive(),
  currency: z.string().default('TZS'),
  method: z.enum(['mobile_money', 'card']).default('mobile_money'),
  phoneNumber: z.string().optional(),
  customerId: z.string().optional(),
});
router.post('/clickpesa/init', async (req, res, next) => {
  try {
    const parsed = initSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
    const { invoiceId, amount, currency, method, phoneNumber, customerId } = parsed.data;

    const user = (req as any).user;
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { customer: true } });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    // Customer can only pay own invoice
    if (user.role === 'CUSTOMER') {
      const ownerOk = invoice.customer && invoice.customer.ownerId === user.sub;
      if (!ownerOk) return res.status(403).json({ error: 'Forbidden' });
    }
    if (user.role !== 'CUSTOMER') {
      const ok = await hasPermission(user.sub, 'invoices:record_payment');
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }


    // Create payment row as pending
    const payment = await prisma.payment.create({
      data: {
        invoiceId,
        amount,
        currency,
        method: 'clickpesa',
        status: 'pending',
      },
    });

    const env = process.env.CLICKPESA_ENVIRONMENT || 'sandbox';
    let checkoutUrl = `https://sandbox.clickpesa.local/checkout/${payment.id}`;
    let providerRef = payment.id;

    // If credentials are configured, call the real API
    if (process.env.CLICKPESA_CLIENT_ID && process.env.CLICKPESA_API_KEY) {
      try {
        const { initiateUssdPush, previewCardPayment, initiateCardPayment } = await import('../services/clickpesa');
        if (method === 'mobile_money') {
          const phone = phoneNumber || (req.body as any).phoneNumber;
          if (phone) {
            const result = await initiateUssdPush({ amount, currency, orderReference: payment.id, phoneNumber: phone });
            providerRef = result?.data?.orderReference || result?.orderReference || payment.id;
            checkoutUrl = result?.data?.redirectUrl || result?.redirectUrl || checkoutUrl;
          }
        } else if (method === 'card') {
          // Optional: preview first for fees, then initiate
          await previewCardPayment({ amount, currency, orderReference: payment.id });
          const custId = customerId || (req.body as any).customerId || 'customer';
          const result = await initiateCardPayment({ amount, currency, orderReference: payment.id, customerId: custId });
          providerRef = result?.data?.orderReference || result?.orderReference || payment.id;
          checkoutUrl = result?.data?.redirectUrl || result?.redirectUrl || checkoutUrl;
        }
      } catch (e) {
        console.error('ClickPesa initiation error', e);
      }
    }

    res.json({ paymentId: payment.id, reference: providerRef, checkoutUrl, environment: env });
  } catch (err) {
    next(err);
  }
});

// Public webhook with raw-body capture for optional signature verification
const webhookRouter = Router();

// Capture raw body for HMAC if secret is configured
webhookRouter.use('/clickpesa/webhook', express.json({
  type: '*/*',
  verify: (req: any, _res, buf) => { req.rawBody = buf; }
}));

// Optional: IP allowlist
function isIpAllowed(ip: string): boolean {
  const allowed = (process.env.CLICKPESA_ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true; // if not set, allow all (dev)
  const cleanIp = (ip || '').replace('::ffff:', '');
  return allowed.includes(cleanIp);
}

webhookRouter.post('/clickpesa/webhook', async (req: any, res) => {
  if (!isIpAllowed(req.ip)) return res.status(403).json({ error: 'Forbidden IP' });

  const secret = process.env.CLICKPESA_WEBHOOK_SECRET || '';
  const signatureHeader = (req.headers['x-clickpesa-signature'] || req.headers['x-signature'] || req.headers['x-hub-signature']) as string | undefined;

  // Verify signature if secret provided
  if (secret) {
    if (!signatureHeader) return res.status(400).json({ error: 'Missing signature' });
    const raw: Buffer = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const computed = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (computed !== signatureHeader) return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    // The docs show payloads like { event: 'PAYMENT RECEIVED', data: { orderReference, status, ... } }
    const body = req.body || {};
    const event: string = body.event || body.eventType || '';
    const data = body.data || {};
    const reference: string | undefined = data.orderReference || body.orderReference || data.paymentId || body.paymentId;

    if (!reference) return res.status(400).json({ error: 'Missing payment reference' });

    // Server-to-server verification for status
    let remoteStatus: string | undefined;
    try {
      const { getPayment } = await import('../services/clickpesa');
      const r = await getPayment(reference);
      remoteStatus = (r?.data?.status || r?.status || '').toString().toUpperCase();
    } catch (e) {
      // Fallback to event/data status if remote verification fails
      remoteStatus = (data.status || body.status || '').toString().toUpperCase();
    }

    const payment = await prisma.payment.findFirst({ where: { id: reference } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const map: Record<string, 'completed'|'failed'|'pending'|'processing'> = {
      SUCCESS: 'completed', COMPLETED: 'completed',
      FAILED: 'failed',
      PENDING: 'pending', PROCESSING: 'processing'
    };
    const newStatus = map[remoteStatus || ''] || 'processing';
    // Idempotent update
    if (payment.status !== newStatus) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: newStatus } });
    }

    // Recompute invoice amounts
    const agg = await prisma.payment.aggregate({ _sum: { amount: true }, where: { invoiceId: payment.invoiceId, status: 'completed' } });
    const inv = await prisma.invoice.findUnique({ where: { id: payment.invoiceId } });
    if (inv) {
      const newPaid = agg._sum.amount ?? 0;
      const newBalance = (inv.totalAmount as any) - (newPaid as any);
      await prisma.invoice.update({ where: { id: inv.id }, data: { paidAmount: newPaid, balanceAmount: newBalance, status: newBalance <= 0 ? 'paid' : inv.status } });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Webhook error', e);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

// Mount webhook router without auth
export const publicPaymentsRouter = webhookRouter;
// Lightweight status endpoint with optional remote refresh
router.get('/status/:reference', async (req, res) => {
  const { reference } = req.params;
  const user = (req as any).user;
  if (user.role !== 'CUSTOMER') {
    const ok = await hasPermission(user.sub, 'payments:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const payment = await prisma.payment.findUnique({ where: { id: reference } });
  if (!payment) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'CUSTOMER') {
    const inv = await prisma.invoice.findUnique({ where: { id: payment.invoiceId }, include: { customer: true } });
    if (!inv || inv.customer?.ownerId !== user.sub) return res.status(403).json({ error: 'Forbidden' });
  }
  let status = payment.status;
  if (['pending','processing'].includes(status)) {
    try {
      const { getPayment } = await import('../services/clickpesa');
      const r = await getPayment(reference);
      const remote = (r?.data?.status || r?.status || '').toString().toUpperCase();
      const map: any = { SUCCESS: 'completed', COMPLETED: 'completed', FAILED: 'failed', PENDING: 'pending', PROCESSING: 'processing' };
      const newStatus = map[remote] || status;
      if (newStatus !== status) {
        await prisma.payment.update({ where: { id: reference }, data: { status: newStatus } });
        status = newStatus;
        if (newStatus === 'completed') {
          const agg = await prisma.payment.aggregate({ _sum: { amount: true }, where: { invoiceId: payment.invoiceId, status: 'completed' } });
          const inv = await prisma.invoice.findUnique({ where: { id: payment.invoiceId } });
          if (inv) {
            const newPaid = agg._sum.amount ?? 0;
            const newBalance = (inv.totalAmount as any) - (newPaid as any);
            await prisma.invoice.update({ where: { id: inv.id }, data: { paidAmount: newPaid, balanceAmount: newBalance, status: newBalance <= 0 ? 'paid' : inv.status } });
          }
        }
      }
    } catch {}
  }
  res.json({ reference, status });
});


// Utility: fetch payment by id (secured)
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  const user = (req as any).user;
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'CUSTOMER') {
    const inv = await prisma.invoice.findUnique({ where: { id: payment.invoiceId }, include: { customer: true } });
    if (!inv || inv.customer?.ownerId !== user.sub) return res.status(403).json({ error: 'Forbidden' });
  } else {
    const ok = await hasPermission(user.sub, 'payments:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(payment);
});

