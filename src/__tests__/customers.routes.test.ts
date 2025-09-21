import request from 'supertest';
import { app } from '../app';

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: () => ({ sub: 'user_1', role: 'ADMIN' }) }
}));

jest.mock('../lib/prisma', () => {
  const customer = {
    id: 'cust_1',
    customerNumber: 'CUST000001',
    type: 'INDIVIDUAL',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    __esModule: true,
    prisma: {
      customer: {
        findMany: jest.fn(async () => [customer]),
        create: jest.fn(async ({ data }: any) => ({ ...customer, ...data })),
      }
    }
  };
});

describe('Customer routes', () => {
  it('creates a customer with auto-generated customer number', async () => {
    const payload = {
      type: 'INDIVIDUAL',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      phone: '+1234567891',
    };

    const res = await request(app)
      .post('/customers')
      .set('Authorization', 'Bearer test')
      .send(payload)
      .expect(201);

    expect(res.body).toHaveProperty('customerNumber');
    expect(res.body.email).toBe('jane@example.com');
  });

  it('lists customers for admin', async () => {
    const res = await request(app)
      .get('/customers')
      .set('Authorization', 'Bearer test')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});
