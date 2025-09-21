import request from 'supertest';
import { app } from '../app';

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: () => ({ sub: 'user_1', role: 'ADMIN' }) }
}));

// Stub nodemailer
const sendMail = jest.fn(async () => ({ messageId: 'test-msg-1' }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: () => ({ sendMail }) }
}));

jest.mock('../lib/prisma', () => {
  const now = new Date();
  const invoice = {
    id: 'inv_1', invoiceNumber: 'INV-202501-0001',
    customerId: 'cust_1', customer: { email: 'customer@example.com' },
    items: [{ id: 'it_1', description: 'Test', quantity: 1, unitPrice: 100, total: 100 }],
    subtotal: 100, taxAmount: 0, discountAmount: 0, totalAmount: 100,
    paidAmount: 0, balanceAmount: 100, currency: 'TZS',
    issueDate: now, dueDate: now,
    payments: []
  };
  return {
    __esModule: true,
    prisma: {
      invoice: { findUnique: jest.fn(async () => invoice) },
      payment: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })) },
      customer: { findFirst: jest.fn(async () => ({ id: 'cust_1' })) }
    }
  };
});

describe('Email invoice route', () => {
  it('sends email with PDF attachment', async () => {
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '1025';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASS = 'pass';

    const res = await request(app)
      .post('/invoices/inv_1/email')
      .set('Authorization', 'Bearer test')
      .send({ to: 'customer@example.com', subject: 'Subj', message: 'Body' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(sendMail).toHaveBeenCalled();
    const arg = (sendMail as any).mock.calls[0][0];
    expect(arg.attachments?.[0]?.filename).toContain('invoice-');
  });
});

