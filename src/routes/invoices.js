const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { logAudit } = require('../lib/audit');
const { authenticate, requireRole } = require('../middleware/auth');
const { hasPermission } = require('../lib/permissions');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const { sendInvoiceNotification, sendPaymentNotification } = require('../lib/notifications');

const bwipjs = require('bwip-js');

async function generateBarcode(text) {
  try {
    if (!text) return null;
    const buf = await bwipjs.toBuffer({
      bcid: 'code128',
      text,
      scale: 2,
      height: 12,
      includetext: false,
      backgroundcolor: 'FFFFFF'
    });
    return buf;
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

function drawLabel(doc, x, y, text) {
  doc.fontSize(8).fillColor('#666').text(text, x, y);
  doc.fillColor('black');
}

function drawBox(doc, x, y, w, h, label) {
  doc.lineWidth(0.8).strokeColor('#999').rect(x, y, w, h).stroke();
  if (label) drawLabel(doc, x + 4, y - 10, label);
}

function textInBox(doc, x, y, w, h, text, opts = {}) {
  if (!text) return;
  doc.fontSize(opts.fontSize || 10).fillColor('black').text(String(text), x + 6, y + 6, { width: w - 12 });
}

function drawRTExpressAirwaybill(doc, invoice, shipment, barcode) {
  const brandColor = '#f41a1aff'; // RT Express red
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 40;
  const innerW = pageW - margin * 2;

  // Use shipment tracking number if available, otherwise use invoice number
  const documentNumber = shipment?.trackingNumber || invoice.invoiceNumber || invoice.id;

  // Helper function to draw a clean box with proper padding
  function drawCleanBox(x, y, width, height, label, options = {}) {
    const { fillColor = '#f8f9fa', strokeColor = '#333', lineWidth = 1, labelBg = brandColor } = options;

    // Draw main box
    doc.save();
    doc.lineWidth(lineWidth).strokeColor(strokeColor);
    if (fillColor) {
      doc.rect(x, y, width, height).fillAndStroke(fillColor, strokeColor);
    } else {
      doc.rect(x, y, width, height).stroke();
    }
    doc.restore();

    // Draw label if provided
    if (label) {
      const labelHeight = 16;
      doc.save();
      doc.rect(x, y - labelHeight, width, labelHeight).fillAndStroke(labelBg, strokeColor);
      doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
      doc.text(label, x + 4, y - labelHeight + 4, { width: width - 8, align: 'left' });
      doc.restore();
    }
  }

  // Helper function to add text with proper padding
  function addTextToBox(x, y, width, height, text, options = {}) {
    const { fontSize = 10, align = 'left', font = 'Helvetica', color = 'black' } = options;
    if (!text) return;

    doc.save();
    doc.fillColor(color).fontSize(fontSize).font(font);
    const padding = 6;
    doc.text(String(text), x + padding, y + padding, {
      width: width - padding * 2,
      height: height - padding * 2,
      align: align
    });
    doc.restore();
  }

  let currentY = margin;

  // 1. PROFESSIONAL INVOICE HEADER
  const headerHeight = 100;

  // Company logo and name (left side)
  const logoWidth = 150;
  doc.save();
  doc.fillColor(brandColor).fontSize(28).font('Helvetica-Bold');
  doc.text('RT EXPRESS', margin, currentY + 10);
  doc.fontSize(12).font('Helvetica');
  doc.fillColor('#666');
  doc.text('Real Time Express Logistics', margin, currentY + 45);
  doc.restore();

  // Invoice title and number (right side)
  const rightSectionX = margin + innerW - 200;
  doc.save();
  doc.fillColor(brandColor).fontSize(24).font('Helvetica-Bold');
  const documentTitle = shipment ? 'INVOICE' : 'INVOICE';
  doc.text(documentTitle, rightSectionX, currentY + 10, { width: 200, align: 'right' });
  doc.restore();

  // Document number with prominent display
  doc.save();
  doc.fillColor('#333').fontSize(16).font('Helvetica-Bold');
  doc.text(documentNumber, rightSectionX, currentY + 40, { width: 200, align: 'right' });
  doc.restore();

  // Invoice details
  doc.save();
  doc.fillColor('#666').fontSize(10).font('Helvetica');
  doc.text(`Invoice #: ${invoice.invoiceNumber}`, rightSectionX, currentY + 65, { width: 200, align: 'right' });
  doc.text(`Date: ${new Date(invoice.issueDate).toLocaleDateString()}`, rightSectionX, currentY + 80, { width: 200, align: 'right' });
  doc.restore();

  currentY += headerHeight + 10;

  // Horizontal line separator
  doc.save();
  doc.strokeColor('#ddd').lineWidth(1);
  doc.moveTo(margin, currentY).lineTo(margin + innerW, currentY).stroke();
  doc.restore();

  currentY += 20;

  // 2. COMPANY AND BILLING INFORMATION
  const sectionSpacing = 20;
  const columnWidth = (innerW - 30) / 2;

  // Company Information (left)
  doc.save();
  doc.fillColor('#333').fontSize(12).font('Helvetica-Bold');
  doc.text('FROM:', margin, currentY);
  doc.restore();

  const companyInfo = [
    'RT EXPRESS',
    '12 Nyerere Road, Dar es Salaam',
    'Tanzania',
    'Phone: +255 756 449 449',
    'Email: info@rtexpress.co.tz',
    'Website: www.rtexpress.co.tz'
  ];

  let textY = currentY + 20;
  companyInfo.forEach((line, index) => {
    doc.save();
    doc.fillColor('#333').fontSize(index === 0 ? 11 : 10);
    doc.font(index === 0 ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(line, margin, textY);
    doc.restore();
    textY += 14;
  });

  // Customer Information (right)
  const customerX = margin + columnWidth + 30;
  doc.save();
  doc.fillColor('#333').fontSize(12).font('Helvetica-Bold');
  doc.text('BILL TO:', customerX, currentY);
  doc.restore();

  const customerName = invoice.customer?.companyName ||
    [invoice.customer?.firstName, invoice.customer?.lastName].filter(Boolean).join(' ') ||
    'Customer';

  const customerInfo = [
    customerName,
    invoice.customer?.street || '',
    [invoice.customer?.city, invoice.customer?.state].filter(Boolean).join(', '),
    [invoice.customer?.zipCode, invoice.customer?.country].filter(Boolean).join(' '),
    invoice.customer?.phone || '',
    invoice.customer?.email || ''
  ].filter(Boolean);

  textY = currentY + 20;
  customerInfo.forEach((line, index) => {
    doc.save();
    doc.fillColor('#333').fontSize(index === 0 ? 11 : 10);
    doc.font(index === 0 ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(line, customerX, textY);
    doc.restore();
    textY += 14;
  });

  currentY += 140;

  // 3. SHIPMENT DETAILS (if shipment exists)
  if (shipment) {
    // Horizontal line
    doc.save();
    doc.strokeColor('#ddd').lineWidth(1);
    doc.moveTo(margin, currentY).lineTo(margin + innerW, currentY).stroke();
    doc.restore();

    currentY += 15;

    doc.save();
    doc.fillColor('#333').fontSize(12).font('Helvetica-Bold');
    doc.text('SHIPMENT DETAILS:', margin, currentY);
    doc.restore();

    currentY += 20;

    const detailsData = [
      { label: 'Tracking Number:', value: shipment.trackingNumber },
      { label: 'Service Type:', value: shipment.packageType || 'Standard' },
      { label: 'Weight:', value: shipment.weightValue ? `${shipment.weightValue} ${shipment.weightUnit}` : 'N/A' },
      { label: 'Dimensions:', value: shipment.length ? `${shipment.length}×${shipment.width}×${shipment.height} ${shipment.dimensionUnit}` : 'N/A' },
      { label: 'Status:', value: shipment.status || 'Processing' },
      { label: 'Priority:', value: shipment.priority || 'Standard' }
    ];

    const detailsPerRow = 2;
    const detailWidth = (innerW - 30) / detailsPerRow;

    detailsData.forEach((detail, index) => {
      const row = Math.floor(index / detailsPerRow);
      const col = index % detailsPerRow;
      const x = margin + col * (detailWidth + 30);
      const y = currentY + row * 20;

      doc.save();
      doc.fillColor('#666').fontSize(10).font('Helvetica');
      doc.text(detail.label, x, y);
      doc.fillColor('#333').font('Helvetica-Bold');
      doc.text(detail.value, x + 100, y);
      doc.restore();
    });

    currentY += Math.ceil(detailsData.length / detailsPerRow) * 20 + 20;
  }

  // 4. INVOICE ITEMS TABLE
  // Horizontal line
  doc.save();
  doc.strokeColor('#ddd').lineWidth(1);
  doc.moveTo(margin, currentY).lineTo(margin + innerW, currentY).stroke();
  doc.restore();

  currentY += 15;

  // Table header
  const tableHeaderHeight = 30;
  doc.save();
  doc.rect(margin, currentY, innerW, tableHeaderHeight).fillAndStroke('#f8f9fa', '#ddd');
  doc.restore();

  // Column widths
  const descWidth = innerW * 0.5;
  const qtyWidth = innerW * 0.15;
  const priceWidth = innerW * 0.175;
  const totalWidth = innerW * 0.175;

  // Table headers
  doc.save();
  doc.fillColor('#333').fontSize(11).font('Helvetica-Bold');
  doc.text('DESCRIPTION', margin + 10, currentY + 10);
  doc.text('QTY', margin + descWidth + 10, currentY + 10, { width: qtyWidth - 20, align: 'center' });
  doc.text('UNIT PRICE', margin + descWidth + qtyWidth + 10, currentY + 10, { width: priceWidth - 20, align: 'center' });
  doc.text('TOTAL', margin + descWidth + qtyWidth + priceWidth + 10, currentY + 10, { width: totalWidth - 20, align: 'center' });
  doc.restore();

  currentY += tableHeaderHeight;

  // Table rows
  const rowHeight = 25;
  (invoice.items || []).forEach((item, index) => {
    // Alternate row colors
    if (index % 2 === 0) {
      doc.save();
      doc.rect(margin, currentY, innerW, rowHeight).fillAndStroke('#fafafa', '#eee');
      doc.restore();
    } else {
      doc.save();
      doc.rect(margin, currentY, innerW, rowHeight).stroke('#eee');
      doc.restore();
    }

    doc.save();
    doc.fillColor('#333').fontSize(10).font('Helvetica');

    // Description
    doc.text(item.description || 'Service', margin + 10, currentY + 8, { width: descWidth - 20 });

    // Quantity
    doc.text(String(item.quantity || 1), margin + descWidth + 10, currentY + 8, { width: qtyWidth - 20, align: 'center' });

    // Unit Price
    doc.text(`${Number(item.unitPrice || 0).toFixed(2)} ${invoice.currency}`, margin + descWidth + qtyWidth + 10, currentY + 8, { width: priceWidth - 20, align: 'center' });

    // Total
    doc.text(`${Number(item.total || 0).toFixed(2)} ${invoice.currency}`, margin + descWidth + qtyWidth + priceWidth + 10, currentY + 8, { width: totalWidth - 20, align: 'center' });

    doc.restore();
    currentY += rowHeight;
  });

  // Table bottom border
  doc.save();
  doc.strokeColor('#ddd').lineWidth(1);
  doc.moveTo(margin, currentY).lineTo(margin + innerW, currentY).stroke();
  doc.restore();

  currentY += sectionSpacing;

  // 5. NOTES AND TOTALS SECTION
  const notesWidth = innerW * 0.6;
  const totalsWidth = innerW * 0.35;
  const totalsX = margin + notesWidth + 20;

  // Notes section (left)
  if (invoice.notes) {
    doc.save();
    doc.fillColor('#333').fontSize(11).font('Helvetica-Bold');
    doc.text('NOTES:', margin, currentY);
    doc.restore();

    doc.save();
    doc.fillColor('#666').fontSize(10).font('Helvetica');
    doc.text(invoice.notes, margin, currentY + 20, { width: notesWidth });
    doc.restore();
  }

  // Totals section (right)
  const totalsData = [
    { label: 'Subtotal:', value: `${Number(invoice.subtotal || 0).toFixed(2)} ${invoice.currency}`, bold: false },
    { label: 'Tax:', value: `${Number(invoice.taxAmount || 0).toFixed(2)} ${invoice.currency}`, bold: false },
    { label: 'Discount:', value: `${Number(invoice.discountAmount || 0).toFixed(2)} ${invoice.currency}`, bold: false },
    { label: 'TOTAL:', value: `${Number(invoice.totalAmount || 0).toFixed(2)} ${invoice.currency}`, bold: true },
    { label: 'Paid:', value: `${Number(invoice.paidAmount || 0).toFixed(2)} ${invoice.currency}`, bold: false },
    { label: 'BALANCE DUE:', value: `${Number(invoice.balanceAmount || 0).toFixed(2)} ${invoice.currency}`, bold: true }
  ];

  let totalsY = currentY;
  totalsData.forEach((item, index) => {
    // Add background for total and balance due
    if (item.bold) {
      doc.save();
      doc.rect(totalsX, totalsY - 2, totalsWidth, 18).fillAndStroke('#f0f0f0', '#ddd');
      doc.restore();
    }

    doc.save();
    doc.fillColor('#333').fontSize(item.bold ? 11 : 10);
    doc.font(item.bold ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(item.label, totalsX + 10, totalsY + 2);
    doc.text(item.value, totalsX + 10, totalsY + 2, { width: totalsWidth - 20, align: 'right' });
    doc.restore();

    totalsY += 20;
  });

  currentY = Math.max(currentY + (invoice.notes ? 60 : 0), totalsY) + sectionSpacing;

  // 6. PAYMENT TERMS AND FOOTER
  currentY += 20;

  // Payment terms
  doc.save();
  doc.fillColor('#333').fontSize(11).font('Helvetica-Bold');
  doc.text('PAYMENT TERMS:', margin, currentY);
  doc.restore();

  currentY += 20;

  const paymentTerms = [
    `Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`,
    'Payment Methods: Bank Transfer, Mobile Money, Cash',
    'Late payments may incur additional charges',
    'All prices are in ' + (invoice.currency || 'TZS')
  ];

  paymentTerms.forEach(term => {
    doc.save();
    doc.fillColor('#666').fontSize(10).font('Helvetica');
    doc.text('• ' + term, margin, currentY);
    doc.restore();
    currentY += 15;
  });

  currentY += 20;

  // Footer with company information
  if (currentY < pageH - 80) {
    // Horizontal line
    doc.save();
    doc.strokeColor('#ddd').lineWidth(1);
    doc.moveTo(margin, currentY).lineTo(margin + innerW, currentY).stroke();
    doc.restore();

    currentY += 20;

    doc.save();
    doc.fillColor('#666').fontSize(9).font('Helvetica');
    doc.text('RT Express - Real Time Express Logistics', margin, currentY, { width: innerW, align: 'center' });
    doc.text('12 Nyerere Road, Dar es Salaam, Tanzania | Phone: +255 756 449 449 | Email: info@rtexpress.co.tz',
      margin, currentY + 12, { width: innerW, align: 'center' });
    doc.text('Terms and conditions apply. Visit www.rtexpress.co.tz for more information.',
      margin, currentY + 24, { width: innerW, align: 'center' });
    doc.restore();
  }
}

const router = Router();

router.use(authenticate);

const createSchema = z.object({
  customerId: z.string(),
  shipmentId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  status: z.string().default('draft'),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
    discount: z.number().nonnegative().default(0),
    total: z.number().nonnegative().optional()
  })),
  taxes: z.array(z.object({
    name: z.string(),
    rate: z.number().nonnegative(),
    amount: z.number().nonnegative().optional()
  })).optional(),
  discountAmount: z.number().nonnegative().default(0),
  currency: z.string().default('TZS'),
  issueDate: z.string(),
  dueDate: z.string(),
  notes: z.string().optional(),
});

router.get('/', async (req, res) => {
  const user = req.user;
  let where = {};
  const { status, q, customerId, page, pageSize, dateFrom, dateTo, dueFrom, dueTo } = req.query;
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
        : invoice.customer.companyName;
      const customerAddress = invoice.customer.street
        ? `${invoice.customer.street}, ${invoice.customer.city}, ${invoice.customer.state} ${invoice.customer.zipCode}, ${invoice.customer.country}`
        : undefined;
      return { ...invoice, customerName, customerEmail: invoice.customer.email, customerAddress };
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
  const user = req.user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });

  const ok = await hasPermission(user.sub, 'invoices:create');
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });

  const { items, taxes = [], discountAmount, ...rest } = parsed.data;
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice * (1 - (it.discount || 0)/100), 0);
  const taxAmount = taxes.reduce((s, t) => s + subtotal * (t.rate/100), 0);
  const totalAmount = subtotal + taxAmount - (discountAmount || 0);

  // Fetch customer information
  const customer = await prisma.customer.findUnique({
    where: { id: rest.customerId }
  });

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const invoiceNumber = rest.invoiceNumber || `INV-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

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
      items: { create: items.map(it => ({ ...it, total: it.total ?? it.quantity * it.unitPrice })) },
    },
    include: { items: true, payments: true, customer: true },
  });
  await logAudit(req, { action: 'INVOICE_CREATE', entityType: 'Invoice', entityId: invoice.id, details: { customerId: customer.id, invoiceNumber } });

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

// Get invoice by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        customer: true,
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Check access permissions
    if (user.role === 'CUSTOMER') {
      const customer = await prisma.customer.findFirst({
        where: { ownerId: user.sub }
      });
      if (!customer || invoice.customerId !== customer.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(invoice);

  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update invoice (admin/staff)
router.patch('/:id', async (req, res) => {
  const id = req.params.id;
  const user = req.user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });

  const ok = await hasPermission(user.sub, 'invoices:update');
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const data = req.body;
  const updated = await prisma.invoice.update({ where: { id }, data, include: { items: true, payments: true } });
  await logAudit(req, { action: 'INVOICE_UPDATE', entityType: 'Invoice', entityId: id, details: { changed: data } });
  res.json(updated);
});

// Delete invoice (admin/staff)
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  const user = req.user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });

  const ok = await hasPermission(user.sub, 'invoices:delete');
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  // Load for audit context then delete
  const existing = await prisma.invoice.findUnique({ where: { id } });
  await prisma.invoice.delete({ where: { id } });
  await logAudit(req, { action: 'INVOICE_DELETE', entityType: 'Invoice', entityId: id, details: { invoiceNumber: existing?.invoiceNumber } });
  res.status(204).send();
});

// Add payment
const paymentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('TZS'),
  method: z.string()
});

router.post('/:id/payments', async (req, res) => {
  const user = req.user;
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
  const newBalance = invoice.totalAmount - newPaid;

  await prisma.invoice.update({
    where: { id },
    data: {
      paidAmount: newPaid,
      balanceAmount: newBalance,
      status: newBalance <= 0 ? 'paid' : (invoice.status === 'cancelled' ? invoice.status : invoice.status)
    }
  });
  await logAudit(req, { action: 'PAYMENT_CREATE', entityType: 'Invoice', entityId: id, details: { amount: parsed.data.amount, currency: parsed.data.currency, method: parsed.data.method, paymentId: payment.id } });

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
  const user = req.user;
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
  await logAudit(req, { action: 'INVOICE_BULK_DELETE', entityType: 'Invoice', entityId: null, details: { ids, deleted: result.count } });

  res.json({ ok: true, deleted: result.count });
});

// Send invoice via email (with PDF attachment)
router.post('/:id/email', async (req, res) => {
  const id = req.params.id;
  const user = req.user;
  if (user.role === 'CUSTOMER') return res.status(403).json({ error: 'Forbidden' });

  const ok = await hasPermission(user.sub, 'invoices:send');
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const { to, subject, message } = req.body || {};
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { items: true, payments: true, customer: true }
  });

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const recipient = to || invoice.customer?.email;
  if (!recipient) return res.status(400).json({ error: 'Recipient email not available' });

  // Configure transport (ENV must be provided)
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) return res.status(500).json({ error: 'SMTP not configured' });

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });

  try {
    const customerName = invoice.customer?.companyName ||
      [invoice.customer?.firstName, invoice.customer?.lastName].filter(Boolean).join(' ') ||
      invoice.customerId;

    const emailSubject = subject || `Invoice ${invoice.invoiceNumber} from RTEXPRESS`;
    const emailMessage = message || 'Please find attached your invoice.';

    const htmlContent = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Invoice ${invoice.invoiceNumber}</title>
      </head>
      <body style="font-family: Arial, sans-serif; color: #080808;">
        <div style="max-width: 640px; margin: 0 auto; padding: 16px;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="font-weight:700; font-size: 22px; color: #2563eb;">RTEXPRESS</div>
            <div style="text-align:right; font-size:12px; color:#555;">
              <div><strong>Invoice:</strong> ${invoice.invoiceNumber}</div>
              <div><strong>Issue:</strong> ${new Date(invoice.issueDate).toLocaleDateString()}</div>
              <div><strong>Due:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</div>
            </div>
          </div>
          <hr style="border:0;border-top:2px solid #2563eb; margin:12px 0;" />
          <p style="white-space:pre-wrap">${emailMessage}</p>
          <h3 style="color:#2563eb;">Bill To</h3>
          <p><strong>${customerName}</strong></p>
          <p>Thank you for your business!</p>
          <hr style="border:0;border-top:1px solid #ddd; margin:20px 0;" />
          <p style="font-size:12px; color:#666;">
            This is an automated message from RTEXPRESS. Please do not reply to this email.
          </p>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: recipient,
      subject: emailSubject,
      html: htmlContent,
      text: `${emailMessage}\n\nInvoice: ${invoice.invoiceNumber}\nIssue Date: ${new Date(invoice.issueDate).toLocaleDateString()}\nDue Date: ${new Date(invoice.dueDate).toLocaleDateString()}\n\nBill To: ${customerName}\n\nThank you for your business!`
    });

    // Send notification to customer about invoice email
    if (invoice.customer?.ownerId) {
      await sendInvoiceNotification(
        invoice.customer.ownerId,
        invoice.invoiceNumber,
        'sent',
        invoice.id
      );
    }

    await logAudit(req, { action: 'INVOICE_EMAIL_SEND', entityType: 'Invoice', entityId: id, details: { to: recipient, subject: emailSubject } });
    res.json({ ok: true, message: 'Invoice sent successfully' });
  } catch (error) {
    console.error('Error sending invoice email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Generate PDF
router.get('/:id/pdf', async (req, res) => {
  const id = req.params.id;
  const user = req.user;
  if (user.role !== 'CUSTOMER') {
    const ok = await hasPermission(user.sub, 'invoices:read');
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: true,
      payments: true,
      customer: true
    }
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (user.role === 'CUSTOMER' && invoice.customer?.ownerId !== user.sub) return res.status(403).json({ error: 'Forbidden' });

  // Try to find a related shipment for this customer and invoice
  let relatedShipment = null;
  if (invoice.customer) {
    // Look for the most recent shipment for this customer
    relatedShipment = await prisma.shipment.findFirst({
      where: { customerId: invoice.customerId },
      orderBy: { createdAt: 'desc' }
    });
    console.log('Related shipment found:', relatedShipment ? relatedShipment.trackingNumber : 'None');
  }

  res.setHeader('Content-Type', 'application/pdf');

  // Use shipment tracking number for filename if available, otherwise use invoice number
  const documentNumber = relatedShipment?.trackingNumber || invoice.invoiceNumber || invoice.id;
  const filename = relatedShipment ? `shipment-${documentNumber}.pdf` : `invoice-${invoice.invoiceNumber || invoice.id}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  doc.pipe(res);

  // Use shipment tracking number for barcode if available, otherwise use invoice number
  const barcode = isBarcodeEnabled() ? await generateBarcode(String(documentNumber)) : null;

  drawRTExpressAirwaybill(doc, invoice, relatedShipment, barcode || undefined);
  doc.end();
});

module.exports = { router };
