import request from 'supertest';
import { app } from '../app';

// Minimal stubs for auth: inject a valid Authorization header
const token = `Bearer ${Buffer.from('test').toString('base64')}`; // middleware expects JWT verify; in real tests, mock verify

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    verify: () => ({ sub: 'user_1', role: 'ADMIN' })
  }
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
      invoice: {
        findUnique: jest.fn(async ({ where }: any) => where.id === 'inv_1' ? invoice : null),
        findMany: jest.fn(async () => [invoice])
      },
      payment: {
        findMany: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { amount: 0 } }))
      },
      customer: { findFirst: jest.fn(async () => ({ id: 'cust_1' })) }
    }
  };
});

describe('Invoice routes', () => {
  it('returns PDF for GET /invoices/:id/pdf', async () => {
    const res = await request(app)
      .get('/invoices/inv_1/pdf')
      .set('Authorization', token)
      .expect(200);
    expect(res.header['content-type']).toContain('application/pdf');
  });

  it('returns stats summary', async () => {
    const res = await request(app)
      .get('/invoices/stats/summary')
      .set('Authorization', token)
      .expect(200);
    expect(res.body).toHaveProperty('total');
  });
});

