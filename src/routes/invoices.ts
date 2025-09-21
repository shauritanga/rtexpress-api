import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hasPermission } from '../lib/permissions';
import { authenticate, requireRole } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import fs from 'fs';
import { sendInvoiceNotification, sendPaymentNotification } from '../lib/notifications';

import * as bwipjs from 'bwip-js';

async function generateBarcode(text: string): Promise<Buffer | null> {
  try {
    if (!text) return null;
    const buf = await bwipjs.toBuffer({
      bcid: 'code128',
      text,
      scale: 2,
      height: 12,
      includetext: false,
      backgroundcolor: 'FFFFFF'
    } as any);
    return buf as Buffer;
  } catch (e) {
    console.error('Barcode generation error:', e);
    return null;
  }
}

function brandColor() {
  return process.env.INVOICE_BRAND_COLOR || '#2858B8'; // default RT Express blue from logo
}
function isBarcodeEnabled() {
  const v = (process.env.INVOICE_BARCODE || '').toLowerCase();
  if (!v) return true; // default on
  return !['0','false','off','no'].includes(v);
}



export const router = Router();

router.use(authenticate);



const createSchema = z.object({
  customerId: z.string(),
  shipmentId: z.string().optional(),
  invoiceNumber: z.string().optional(),

  status: z.string().default('draft'),
  items: z.array(z.object({ description: z.string(), quantity: z.number().int().positive(), unitPrice: z.number().nonnegative(), discount: z.number().nonnegative().default(0), total: z.number().nonnegative().optional() })),
  taxes: z.array(z.object({ name: z.string(), rate: z.number().nonnegative(), amount: z.number().nonnegative().optional() })).optional(),
  discountAmount: z.number().nonnegative().default(0),
  currency: z.string().default('TZS'),
  issueDate: z.string(),
  dueDate: z.string(),
  notes: z.string().optional(),
});

router.get('/', async (req, res) => {
  const user = (req as any).user;
  let where: any = {};
  const { status, q, customerId, page, pageSize, dateFrom, dateTo, dueFrom, dueTo } = req.query as any;
  const take = pageSize ? Math.min(Math.max(parseInt(String(pageSize), 10) || 25, 1), 100) : undefined;
  const skip = page && take ? Math.max(((parseInt(String(page), 10) || 1) - 1) * take, 0) : undefined;

  if (user.role === 'CUSTOMER') {
    const customer = await prisma.customer.findFirst({ where: { ownerId: user.sub } });
    where = customer ? { customerId: customer.id } : { id: '__none__' };
  } else {
    const ok = await hasPermission(user.sub, 'invoices:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    if (customerId) where.customerId = String(customerId);
  }

  // Status and special "overdue" handling
  if (status) {
    const st = String(status).toLowerCase();
    if (st === 'overdue') {
      where.AND = [ ...(where.AND || []),
        { balanceAmount: { gt: 0 } },
        { dueDate: { lt: new Date() } },
        { NOT: { status: { in: ['paid', 'cancelled'] } } }
      ];
    } else {
      where.status = st;
    }
  }

  // Text search
  if (q) {
    const term = String(q);
    where.OR = [
      { invoiceNumber: { contains: term } },
      { customer: { OR: [
        { firstName: { contains: term } },
        { lastName: { contains: term } },
        { companyName: { contains: term } },
        { email: { contains: term } },
      ] } }
    ];
  }

  // Date filters (issue date)
  if (dateFrom) {
    where.AND = [ ...(where.AND || []), { issueDate: { gte: new Date(String(dateFrom)) } } ];
  }
  if (dateTo) {
    const end = new Date(String(dateTo));
    where.AND = [ ...(where.AND || []), { issueDate: { lte: end } } ];
  }
  // Due date filters
  if (dueFrom) {
    where.AND = [ ...(where.AND || []), { dueDate: { gte: new Date(String(dueFrom)) } } ];
  }
  if (dueTo) {
    const endDue = new Date(String(dueTo));
    where.AND = [ ...(where.AND || []), { dueDate: { lte: endDue } } ];
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { items: true, payments: true, customer: true },
      orderBy: { updatedAt: 'desc' },
      skip: skip, take: take,
    }),
    prisma.invoice.count({ where })
  ]);

  const mapped = invoices.map(invoice => {
    if (invoice.customer) {
      const customerName = invoice.customer.type === 'INDIVIDUAL'
        ? `${invoice.customer.firstName ?? ''} ${invoice.customer.lastName ?? ''}`.trim()
        : (invoice.customer.companyName as any);
      const customerAddress = invoice.customer.street
        ? `${invoice.customer.street}, ${invoice.customer.city}, ${invoice.customer.state} ${invoice.customer.zipCode}, ${invoice.customer.country}`
        : undefined;
      return { ...invoice, customerName, customerEmail: (invoice.customer as any).email, customerAddress };
    }
    return invoice;
  });

  if (take && typeof skip === 'number') {
    const currentPage = (skip / take) + 1;
    return res.json({ items: mapped, total, page: currentPage, pageSize: take });
  }
  res.json(mapped);
});

// Create invoice (admin/staff)
router.post('/', async (req, res) => {
  const user = (req as any).user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });
  {
    const ok = await hasPermission(user.sub, 'invoices:create');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const { items, taxes = [], discountAmount, ...rest } = parsed.data as any;
  const subtotal = items.reduce((s: number, it: any) => s + it.quantity * it.unitPrice * (1 - (it.discount || 0)/100), 0);
  const taxAmount = taxes.reduce((s: number, t: any) => s + subtotal * (t.rate/100), 0);
  const totalAmount = subtotal + taxAmount - (discountAmount || 0);

  // Fetch customer information
  const customer = await prisma.customer.findUnique({
    where: { id: rest.customerId }
  });

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const invoiceNumber = (rest as any).invoiceNumber || `INV-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const invoice = await prisma.invoice.create({
    data: {
      ...rest,
      invoiceNumber,
      subtotal,
      taxAmount,
      totalAmount,
      balanceAmount: totalAmount,
      issueDate: new Date(rest.issueDate),
      dueDate: new Date(rest.dueDate),
      items: { create: items.map((it: any) => ({ ...it, total: it.total ?? it.quantity * it.unitPrice })) },
    },
    include: { items: true, payments: true, customer: true },
  });

  // Add customer information to the response
  const customerName = customer.type === 'INDIVIDUAL'
    ? `${customer.firstName} ${customer.lastName}`
    : customer.companyName;

  const customerAddress = customer.street
    ? `${customer.street}, ${customer.city}, ${customer.state} ${customer.zipCode}, ${customer.country}`
    : undefined;

  const invoiceWithCustomerInfo = {
    ...invoice,
    customerName,
    customerEmail: customer.email,
    customerAddress,
  };

  // Send notification to customer about new invoice
  if (customer.ownerId) {
    await sendInvoiceNotification(
      customer.ownerId,
      invoiceNumber,
      'created',
      invoice.id
    );
  }

  res.status(201).json(invoiceWithCustomerInfo);
});

// Update invoice (admin/staff)
router.patch('/:id', async (req, res) => {
  const id = req.params.id;
  const user = (req as any).user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });
  {
    const ok = await hasPermission(user.sub, 'invoices:update');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const data = req.body as any;
  const updated = await prisma.invoice.update({ where: { id }, data, include: { items: true, payments: true } });
  res.json(updated);
});

// Delete invoice (admin/staff)
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  const user = (req as any).user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });
  {
    const ok = await hasPermission(user.sub, 'invoices:delete');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  await prisma.invoice.delete({ where: { id } });
  res.status(204).send();
});

// Add payment
const paymentSchema = z.object({ amount: z.number().positive(), currency: z.string().default('TZS'), method: z.string() });
router.post('/:id/payments', async (req, res) => {
  const user = (req as any).user;
  if (user.role !== 'CUSTOMER') {
    const ok = await hasPermission(user.sub, 'invoices:record_payment');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const id = req.params.id;
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { customer: true } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (user.role === 'CUSTOMER') {
    if (!invoice.customer || invoice.customer.ownerId !== user.sub) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const payment = await prisma.payment.create({ data: { invoiceId: id, ...parsed.data } });
  const paidAmount = await prisma.payment.aggregate({ _sum: { amount: true }, where: { invoiceId: id, status: 'completed' } });
  const newPaid = paidAmount._sum.amount ?? 0;
  const newBalance = (invoice.totalAmount as any) - (newPaid as any);
  const updatedInvoice = await prisma.invoice.update({
    where: { id },
    data: {
      paidAmount: newPaid,
      balanceAmount: newBalance,
      status: newBalance <= 0 ? 'paid' : (String(invoice.status) === 'cancelled' ? invoice.status : invoice.status)
    }
  });

  // Send payment notification to customer
  if (invoice.customer?.ownerId) {
    const paymentStatus = newBalance <= 0 ? 'completed' : 'partial';
    await sendPaymentNotification(
      invoice.customer.ownerId,
      parsed.data.amount,
      paymentStatus,
      invoice.invoiceNumber,
      payment.id
    );
  }

  res.status(201).json(payment);
});

// Bulk delete invoices
router.post('/bulk-delete', async (req, res) => {
  const user = (req as any).user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });
  const ok = await hasPermission(user.sub, 'invoices:delete');
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const schema = z.object({ ids: z.array(z.string()).nonempty() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
  const { ids } = parsed.data;
  // Clean child records first to satisfy FK constraints
  await prisma.payment.deleteMany({ where: { invoiceId: { in: ids } } });
  await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: ids } } });
  const result = await prisma.invoice.deleteMany({ where: { id: { in: ids } } });
  res.json({ ok: true, deleted: result.count });
});

function companyName() { return process.env.INVOICE_COMPANY_NAME || 'RTEXPRESS'; }
function companyAddress() { return process.env.INVOICE_COMPANY_ADDRESS || ''; }
function companyEmail() { return process.env.INVOICE_COMPANY_EMAIL || ''; }
function companyPhone() { return process.env.INVOICE_COMPANY_PHONE || ''; }

function drawHeader(doc: any, invoice: any) {
  const logoPath = process.env.INVOICE_LOGO_PATH;
  if (logoPath && fs.existsSync(logoPath)) {
    try { doc.image(logoPath, 50, 40, { width: 120 }); } catch {}
  }
  doc.fontSize(20).fillColor(brandColor()).text(companyName(), { align: 'right' }).fillColor('black');
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Invoice: ${invoice.invoiceNumber}`, { align: 'right' });
  doc.text(`Issue Date: ${new Date(invoice.issueDate as any).toLocaleDateString()}`, { align: 'right' });
  doc.text(`Due Date: ${new Date(invoice.dueDate as any).toLocaleDateString()}`, { align: 'right' });
  const addr = companyAddress();
  const contact = [companyEmail(), companyPhone()].filter(Boolean).join(' | ');
  if (addr || contact) {
    doc.moveDown(0.25);
    if (addr) doc.fontSize(10).fillColor('#555').text(addr, { align: 'right' });
    if (contact) doc.fontSize(10).fillColor('#555').text(contact, { align: 'right' });
    doc.fillColor('black');
  }
}

function drawBillTo(doc: any, invoice: any) {
  // Accent rule under header
  doc.moveTo(50, 90).lineTo(545, 90).lineWidth(2).stroke(brandColor());

  doc.moveDown(1);
  doc.fontSize(14).text('Bill To');
  const name = invoice.customer?.companyName || [invoice.customer?.firstName, invoice.customer?.lastName].filter(Boolean).join(' ') || invoice.customerId;
  doc.fontSize(12).text(name);
  const lines: string[] = [];
  const addr = invoice.customer;
  if (addr?.street) lines.push(addr.street);
  const cityLine = [addr?.city, addr?.state, addr?.zipCode].filter(Boolean).join(', ');
  if (cityLine) lines.push(cityLine);
  if (addr?.country) lines.push(String(addr.country));
  lines.forEach(l => doc.text(l));
  if ((invoice as any).customerEmail) doc.text((invoice as any).customerEmail);
}

function drawItemsTable(doc: any, invoice: any) {
  doc.moveDown(1);
  doc.fillColor(brandColor()).fontSize(14).text('Items').fillColor('black');
  doc.moveDown(0.5);
  const startX = 50;
  const descW = 260, qtyW = 60, upW = 80, totalW = 100;
  const headerY = doc.y;
  doc.save();
  doc.rect(startX, headerY - 2, descW + qtyW + upW + totalW, 18).fill(brandColor());
  doc.fillColor('white').fontSize(12).text('Description', startX + 6, headerY);
  doc.text('Qty', startX + descW + 6, headerY);
  doc.text('Unit Price', startX + descW + qtyW + 6, headerY);
  doc.text('Total', startX + descW + qtyW + upW + 6, headerY);
  doc.restore();
  doc.moveDown(1);
  invoice.items.forEach((it: any, idx: number) => {
    const rowY = doc.y;
    // Alternating row shading
    if (idx % 2 === 0) {
      doc.save();
      doc.rect(startX, rowY - 2, descW + qtyW + upW + totalW, 16).fill('#f9f9f9');
      doc.restore();
    }
    const total = Number(it.total ?? it.quantity * it.unitPrice);
    doc.text(it.description, startX + 6, rowY, { width: descW - 12 });
    doc.text(String(it.quantity), startX + descW + 6, rowY);
    doc.text(Number(it.unitPrice).toFixed(2), startX + descW + qtyW + 6, rowY);
    doc.text(total.toFixed(2), startX + descW + qtyW + upW + 6, rowY);
  });
}

function drawTotals(doc: any, invoice: any) {
  doc.moveDown(1);
  const rightX = 400;
  doc.text(`Subtotal: ${Number(invoice.subtotal).toFixed(2)} ${invoice.currency}`, rightX);
  doc.text(`Tax: ${Number(invoice.taxAmount).toFixed(2)} ${invoice.currency}`, rightX);
  doc.text(`Discount: ${Number(invoice.discountAmount || 0).toFixed(2)} ${invoice.currency}`, rightX);
  doc.fontSize(14).text(`Total: ${Number(invoice.totalAmount).toFixed(2)} ${invoice.currency}`, rightX);
  doc.fontSize(12).text(`Paid: ${Number(invoice.paidAmount || 0).toFixed(2)} ${invoice.currency}`, rightX);
  doc.text(`Balance: ${Number(invoice.balanceAmount || 0).toFixed(2)} ${invoice.currency}`, rightX);
}

function drawLabel(doc: any, x: number, y: number, text: string) {
  doc.fontSize(8).fillColor('#666').text(text, x, y);
  doc.fillColor('black');
}
function drawBox(doc: any, x: number, y: number, w: number, h: number, label?: string) {
  doc.lineWidth(0.8).strokeColor('#999').rect(x, y, w, h).stroke();
  if (label) drawLabel(doc, x + 4, y - 10, label);
}
function textInBox(doc: any, x: number, y: number, w: number, h: number, text?: string, opts: any = {}) {
  if (!text) return;
  doc.fontSize(opts.fontSize || 10).fillColor('black').text(String(text), x + 6, y + 6, { width: w - 12 });
}

function drawRTExpressAirwaybill(doc: any, invoice: any, barcode?: Buffer) {
  const c = brandColor();
  const pageW = doc.page.width, margin = doc.page.margins.left;
  const innerW = pageW - margin * 2;

  // Header banner
  const bannerH = 40;
  doc.save();
  doc.rect(margin, margin, innerW, bannerH).fill(c);
  doc.fillColor('white').fontSize(18).text((process.env.INVOICE_COMPANY_NAME || 'RT EXPRESS'), margin + 12, margin + 10);
  doc.fontSize(12).text('Airwaybill', margin + innerW - 120, margin + 12, { width: 108, align: 'right' });
  doc.restore();

  // AWB No + barcode box on the right under banner
  const y0 = margin + bannerH + 8;
  drawBox(doc, margin + innerW - 220, y0, 220, 46, 'AIRWAYBILL NO');
  doc.fontSize(14).text(invoice.invoiceNumber || invoice.id, margin + innerW - 214, y0 + 18, { width: 208, align: 'center' });
  // barcode (Code128), fallback to pseudo bars if unavailable
  if (barcode) {
    try {
      doc.image(barcode, margin + innerW - 210, y0 + 6, { width: 200, height: 28, fit: [200, 28] });
    } catch (e) {
      doc.save(); doc.strokeColor('#333').lineWidth(1);
      for (let i = 0; i < 30; i++) {
        const x = margin + innerW - 210 + i * 6;
        doc.moveTo(x, y0 + 8).lineTo(x, y0 + 16).stroke();
      }
      doc.restore();
    }
  } else {
    doc.save(); doc.strokeColor('#333').lineWidth(1);
    for (let i = 0; i < 30; i++) {
      const x = margin + innerW - 210 + i * 6;
      doc.moveTo(x, y0 + 8).lineTo(x, y0 + 16).stroke();
    }
    doc.restore();
  }

  // From / To panels
  const colW = (innerW - 10) / 2;
  const fromY = y0;
  const rowH = 22;
  const leftX = margin, rightX = margin + colW + 10;
  drawLabel(doc, leftX, fromY - 10, 'FROM');
  drawLabel(doc, rightX, fromY - 10, 'TO');
  // Company / Contact fields
  const fields = ['ACCOUNT NO', 'COMPANY NAME', 'STREET ADDRESS', 'CITY/TOWN', 'COUNTRY', 'TEL', 'EMAIL'];
  let y = fromY;
  fields.forEach((lab, idx) => {
    drawBox(doc, leftX, y, colW, rowH, idx === 0 ? 'FROM' : undefined);
    drawBox(doc, rightX, y, colW, rowH, idx === 0 ? 'TO' : undefined);
    y += rowH;
  });
  // Fill TO column with customer data
  const cust = invoice.customer || {};
  const toVals = [ '',
    cust.companyName || `${cust.firstName || ''} ${cust.lastName || ''}`.trim() || invoice.customerId,
    cust.street || '',
    [cust.city, cust.state, cust.zipCode].filter(Boolean).join(', '),
    cust.country || '',
    cust.phone || '',
    cust.email || (invoice as any).customerEmail || ''
  ];
  y = fromY; toVals.forEach((val) => { textInBox(doc, rightX, y, colW, rowH, val); y += rowH; });

  // Shipment summary row (date, pieces, weight, dimensions)
  const sumY = fromY + fields.length * rowH + 8;
  const segW = innerW / 4 - 6;
  const labels = ['DATE', 'PIECES', 'WEIGHT (KG)', 'DIMENSIONS (CM)'];
  const vals = [ new Date(invoice.issueDate).toLocaleDateString(),
    String((invoice.items || []).length), '', '' ];
  for (let i = 0; i < 4; i++) {
    const x = margin + i * (segW + 8);
    drawBox(doc, x, sumY, segW, rowH, labels[i]);
    textInBox(doc, x, sumY, segW, rowH, vals[i]);
  }

  // Contents box
  const contentsY = sumY + rowH + 8;
  drawBox(doc, margin, contentsY, innerW, 60, 'CONTENTS / DESCRIPTION');
  const contents = (invoice.items || []).map((it: any) => it.description).join('; ');
  textInBox(doc, margin, contentsY, innerW, 60, contents);

  // Value / Insurance line
  const viY = contentsY + 60 + 8;
  const vW = innerW * 0.5 - 6;
  drawBox(doc, margin, viY, vW, rowH, 'DECLARED VALUE');
  textInBox(doc, margin, viY, vW, rowH, `${Number(invoice.totalAmount||0).toFixed(2)} ${invoice.currency||''}`);
  // Insurance yes/no
  const insW = 120;
  drawBox(doc, margin + vW + 8, viY, insW, rowH, 'INSURANCE');
  doc.fontSize(10).text('YES', margin + vW + 16, viY + 6);
  doc.rect(margin + vW + 48, viY + 6, 10, 10).stroke();
  doc.text('NO', margin + vW + 70, viY + 6);
  doc.rect(margin + vW + 90, viY + 6, 10, 10).stroke();

  // Signature blocks
  const sigY = viY + rowH + 8;
  const sigH = 40; const sigW = (innerW - 8) / 2;
  drawBox(doc, margin, sigY, sigW, sigH, 'RECEIVED BY RT EXPRESS (SIGN / NAME)');
  drawBox(doc, margin + sigW + 8, sigY, sigW, sigH, 'RECEIVED BY CONSIGNEE (SIGN / NAME)');

  // Totals to the bottom-right for clarity
  const totalsY = sigY + sigH + 12;
  const totW = 220, totH = 80, tx = margin + innerW - totW;
  drawBox(doc, tx, totalsY, totW, totH, 'INVOICE TOTALS');
  doc.fontSize(10);
  doc.text(`Subtotal: ${Number(invoice.subtotal||0).toFixed(2)} ${invoice.currency||''}`, tx + 8, totalsY + 16);
  doc.text(`Tax: ${Number(invoice.taxAmount||0).toFixed(2)} ${invoice.currency||''}`, tx + 8, totalsY + 30);
  doc.fontSize(12).text(`Total: ${Number(invoice.totalAmount||0).toFixed(2)} ${invoice.currency||''}`, tx + 8, totalsY + 46);
  doc.fontSize(10).text(`Paid: ${Number(invoice.paidAmount||0).toFixed(2)}  Balance: ${Number(invoice.balanceAmount||0).toFixed(2)}`, tx + 8, totalsY + 62);

  // Footer: offices/contact
  const footY = totalsY + totH + 16;
  const addr1 = process.env.INVOICE_COMPANY_ADDRESS || '';
  const addr2 = process.env.INVOICE_COMPANY_ADDRESS_2 || '';
  doc.fontSize(9).fillColor('#666');
  if (addr1) doc.text(addr1, margin, footY, { width: innerW/2 - 8 });
  if (addr2) doc.text(addr2, margin + innerW/2 + 8, footY, { width: innerW/2 - 8, align: 'right' });
  const terms = process.env.INVOICE_PAYMENT_TERMS || 'Goods are carried at owner\'s risk. Subject to terms & conditions.';
  doc.moveDown(0.5).fillColor('#777').fontSize(9).text(terms, margin, footY + 18, { width: innerW });
  doc.fillColor('black');
}

// Generate PDF
router.get('/:id/pdf', async (req, res) => {
  const id = req.params.id;
  const user = (req as any).user;
  if (user.role !== 'CUSTOMER') {
    const ok = await hasPermission(user.sub, 'invoices:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true, payments: true, customer: true } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (user.role === 'CUSTOMER' && invoice.customer?.ownerId !== user.sub) return res.status(403).json({ error: 'Forbidden' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber || invoice.id}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  doc.pipe(res);
  const barcode = isBarcodeEnabled() ? await generateBarcode(String(invoice.invoiceNumber || invoice.id)) : null;
  drawRTExpressAirwaybill(doc, invoice, barcode || undefined);
  doc.end();
});

// Send invoice via email (with PDF attachment)
router.post('/:id/email', async (req, res) => {
  const id = req.params.id;
  const user = (req as any).user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });
  {
    const ok = await hasPermission(user.sub, 'invoices:send');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const { to, subject, message } = (req.body || {}) as { to?: string; subject?: string; message?: string };
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true, payments: true, customer: true } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const recipient = to || (invoice as any).customerEmail || invoice.customer?.email;
  if (!recipient) return res.status(400).json({ error: 'Recipient email not available' });

  // Create PDF in memory
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.on('data', (chunk) => chunks.push(chunk as Buffer));
  doc.on('end', async () => {
    const pdfBuffer = Buffer.concat(chunks);

    // Configure transport (ENV must be provided)
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env as any;
    if (!SMTP_HOST || !SMTP_PORT) return res.status(500).json({ error: 'SMTP not configured' });

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
function renderInvoiceHtml(invoice: any, message?: string) {
  const accent = brandColor();
  const customerName = invoice.customer?.companyName || [invoice.customer?.firstName, invoice.customer?.lastName].filter(Boolean).join(' ') || invoice.customerId;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${invoice.invoiceNumber}</title>
</head>
<body style="font-family: Arial, sans-serif; color: #080808;">
  <div style="max-width: 640px; margin: 0 auto; padding: 16px;">
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <div style="font-weight:700; font-size: 22px; color: ${accent};">RTEXPRESS</div>
      <div style="text-align:right; font-size:12px; color:#555;">
        <div><strong>Invoice:</strong> ${invoice.invoiceNumber}</div>
        <div><strong>Issue:</strong> ${new Date(invoice.issueDate).toLocaleDateString()}</div>
        <div><strong>Due:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</div>
      </div>
    </div>
    <hr style="border:0;border-top:2px solid ${accent}; margin:12px 0;" />
    ${message ? `<p style="white-space:pre-wrap">${message}</p>` : '<p>Please find attached your invoice.</p>'}
    <h3 style="color:${accent};">Bill To</h3>
    <div style="font-size:14px;">
      <div>${customerName}</div>
      ${invoice.customer?.street ? `<div>${invoice.customer.street}</div>` : ''}
      ${[invoice.customer?.city, invoice.customer?.state, invoice.customer?.zipCode].filter(Boolean).join(', ')}
      ${invoice.customer?.country ? `<div>${invoice.customer.country}</div>` : ''}
    </div>
    <p style="font-size:12px; color:#666; margin-top:16px;">Thank you for your business!</p>
  </div>
</body>
</html>`;
}


    try {
      const info = await transporter.sendMail({
        from: SMTP_FROM || SMTP_USER,
        to: recipient,
        subject: subject || `Invoice ${invoice.invoiceNumber}`,
        text: message || 'Please find attached your invoice.',
        html: renderInvoiceHtml(invoice, message),
        attachments: [{ filename: `invoice-${invoice.invoiceNumber || invoice.id}.pdf`, content: pdfBuffer }],
      });
      res.json({ ok: true, messageId: info.messageId });
    } catch (e) {
      console.error('Email error', e);
      res.status(500).json({ error: 'Failed to send email' });
    }
  });

  // Render using same builder as /pdf
  const barcode = isBarcodeEnabled() ? await generateBarcode(String(invoice.invoiceNumber || invoice.id)) : null;
  drawRTExpressAirwaybill(doc, invoice, barcode || undefined);
  doc.end();
});

// Invoice/Payment stats for dashboard
router.get('/stats/summary', async (req, res) => {
  const user = (req as any).user;
  let where: any = {};
  if (user.role === 'CUSTOMER') {
    const customer = await prisma.customer.findFirst({ where: { ownerId: user.sub } });
    where = customer ? { customerId: customer.id } : { id: '__none__' };
  }
  else {
    const ok = await hasPermission(user.sub, 'invoices:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const invoices = await prisma.invoice.findMany({ where });
  const payments = await prisma.payment.findMany({ where: { invoiceId: { in: invoices.map(i => i.id) } } });
  const total = invoices.length;
  const byStatus = invoices.reduce((acc: any, i: any) => { acc[i.status] = (acc[i.status]||0)+1; return acc; }, {});
  const totalRevenue = invoices.reduce((s: number, i: any) => s + Number(i.totalAmount||0), 0);
  const pendingAmount = invoices.reduce((s: number, i: any) => s + Number(i.balanceAmount||0), 0);
  const overdueAmount = invoices.filter((i: any) => i.status === 'overdue').reduce((s: number, i: any) => s + Number(i.balanceAmount||0), 0);
  res.json({
    total,
    ...byStatus,
    totalRevenue,
    pendingAmount,
    overdueAmount,
    payments: { total: payments.length, completed: payments.filter(p => p.status==='completed').length }
  });
});

