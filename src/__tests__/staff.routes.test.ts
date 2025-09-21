import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import jwt from 'jsonwebtoken';

const app = createApp();

// Mock admin user for testing
const mockAdminUser = {
  id: 'admin-test-id',
  email: 'admin@test.com',
  name: 'Test Admin',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
};

// Generate JWT token for testing
const generateToken = (user: any) => {
  return jwt.sign(user, process.env.JWT_SECRET || 'test-secret');
};

describe('Staff Routes', () => {
  let authToken: string;
  let createdStaffId: string;

  beforeAll(async () => {
    authToken = generateToken(mockAdminUser);

    // Ensure system roles exist
    await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN', isSystemRole: true } });
    await prisma.role.upsert({ where: { name: 'STAFF' }, update: {}, create: { name: 'STAFF', isSystemRole: true } });
    await prisma.role.upsert({ where: { name: 'CUSTOMER' }, update: {}, create: { name: 'CUSTOMER', isSystemRole: true } });

    // Create admin user in database for authentication
    await prisma.user.upsert({
      where: { email: mockAdminUser.email },
      update: {},
      create: {
        id: mockAdminUser.id,
        email: mockAdminUser.email,
        name: mockAdminUser.name,
        status: mockAdminUser.status,
        passwordHash: 'test-hash',
        role: { connect: { name: 'ADMIN' } },
      },
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: 'admin@test.com' },
          { email: 'staff@test.com' },
        ],
      },
    });
  });

  describe('POST /staff', () => {
    it('should create a new staff member', async () => {
      const staffData = {
        name: 'Test Staff',
        email: 'staff@test.com',
        role: 'STAFF',
        phone: '+1234567890',
      };

      const response = await request(app)
        .post('/staff')
        .set('Authorization', `Bearer ${authToken}`)
        .send(staffData)
        .expect(201);

      expect(response.body).toMatchObject({
        name: staffData.name,
        email: staffData.email,
        role: staffData.role,
        phone: staffData.phone,
        status: 'ACTIVE',
      });

      createdStaffId = response.body.id;
    });

    it('should reject duplicate email', async () => {
      const staffData = {
        name: 'Another Staff',
        email: 'staff@test.com', // Same email as above
        role: 'STAFF',
      };

      await request(app)
        .post('/staff')
        .set('Authorization', `Bearer ${authToken}`)
        .send(staffData)
        .expect(400);
    });
  });

  describe('GET /staff', () => {
    it('should list all staff members', async () => {
      const response = await request(app)
        .get('/staff')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      
      const staffMember = response.body.find((s: any) => s.id === createdStaffId);
      expect(staffMember).toBeDefined();
      expect(staffMember.email).toBe('staff@test.com');
    });
  });

  describe('GET /staff/:id', () => {
    it('should get a specific staff member', async () => {
      const response = await request(app)
        .get(`/staff/${createdStaffId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: createdStaffId,
        name: 'Test Staff',
        email: 'staff@test.com',
        role: 'STAFF',
      });
    });

    it('should return 404 for non-existent staff', async () => {
      await request(app)
        .get('/staff/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('PATCH /staff/:id', () => {
    it('should update staff member', async () => {
      const updateData = {
        name: 'Updated Staff Name',
        status: 'SUSPENDED' as const,
      };

      const response = await request(app)
        .patch(`/staff/${createdStaffId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toMatchObject({
        id: createdStaffId,
        name: updateData.name,
        status: updateData.status,
      });
    });
  });

  describe('DELETE /staff/:id', () => {
    it('should delete staff member', async () => {
      await request(app)
        .delete(`/staff/${createdStaffId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify deletion
      await request(app)
        .get(`/staff/${createdStaffId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('Authorization', () => {
    it('should require authentication', async () => {
      await request(app)
        .get('/staff')
        .expect(401);
    });

    it('should require admin role', async () => {
      const staffUser = {
        id: 'staff-test-id',
        email: 'staff-user@test.com',
        name: 'Test Staff User',
        role: 'STAFF' as const,
        status: 'ACTIVE' as const,
      };

      const staffToken = generateToken(staffUser);

      await request(app)
        .get('/staff')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });
  });
});
