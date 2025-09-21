import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';

describe('Auth Routes', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /auth/register', () => {
    it('should register a new customer successfully', async () => {
      const timestamp = Date.now();
      const registerData = {
        firstName: 'John',
        lastName: 'Doe',
        email: `john.doe.${timestamp}@example.com`,
        password: 'password123',
        confirmPassword: 'password123',
        phone: '+255123456789',
        acceptTerms: true,
      };

      const response = await request(app)
        .post('/auth/register')
        .send(registerData)
        .expect(201);

      expect(response.body).toHaveProperty('message', 'Registration successful');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('customer');

      // Verify user data
      expect(response.body.user).toMatchObject({
        email: registerData.email,
        role: 'CUSTOMER',
        name: 'John Doe',
      });

      // Verify customer data
      expect(response.body.customer).toMatchObject({
        firstName: 'John',
        lastName: 'Doe',
        email: registerData.email,
        phone: '+255123456789',
      });

      // Verify data was saved to database
      const user = await prisma.user.findUnique({
        where: { email: registerData.email },
        include: { role: true },
      });
      expect(user).toBeTruthy();
      // Dynamic roles: role is a relation; ensure assigned CUSTOMER
      // @ts-ignore
      expect(user?.role?.name).toBe('CUSTOMER');

      const customer = await prisma.customer.findUnique({
        where: { email: registerData.email },
      });
      expect(customer).toBeTruthy();
      expect(customer?.firstName).toBe('John');
      expect(customer?.lastName).toBe('Doe');
    });

    it('should return 400 for invalid data', async () => {
      const invalidData = {
        firstName: '',
        lastName: 'Doe',
        email: 'invalid-email',
        password: '123', // Too short
        confirmPassword: '456', // Doesn't match
        acceptTerms: false, // Must be true
      };

      const response = await request(app)
        .post('/auth/register')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid data');
      expect(response.body).toHaveProperty('details');
    });

    it('should return 409 if user already exists', async () => {
      // Create a user first
      const timestamp = Date.now();
      const userData = {
        firstName: 'Jane',
        lastName: 'Smith',
        email: `jane.smith.${timestamp}@example.com`,
        password: 'password123',
        confirmPassword: 'password123',
        acceptTerms: true,
      };

      // First registration should succeed
      await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Second registration with same email should fail
      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(409);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatch(/already exists/);
    });

    it('should return 400 if passwords do not match', async () => {
      const timestamp = Date.now();
      const userData = {
        firstName: 'Bob',
        lastName: 'Wilson',
        email: `bob.wilson.${timestamp}@example.com`,
        password: 'password123',
        confirmPassword: 'differentpassword',
        acceptTerms: true,
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid data');
    });

    it('should register without phone number', async () => {
      const timestamp = Date.now();
      const userData = {
        firstName: 'Alice',
        lastName: 'Johnson',
        email: `alice.johnson.${timestamp}@example.com`,
        password: 'password123',
        confirmPassword: 'password123',
        acceptTerms: true,
        // No phone number
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.customer.phone).toBeNull();
    });
  });

  describe('POST /auth/login', () => {
    let testUserEmail: string;

    beforeEach(async () => {
      // Create a test user for login tests
      const timestamp = Date.now();
      testUserEmail = `test.user.${timestamp}@example.com`;
      const registerData = {
        firstName: 'Test',
        lastName: 'User',
        email: testUserEmail,
        password: 'password123',
        confirmPassword: 'password123',
        acceptTerms: true,
      };

      await request(app)
        .post('/auth/register')
        .send(registerData);
    });

    it('should login successfully with valid credentials', async () => {
      const loginData = {
        email: testUserEmail,
        password: 'password123',
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testUserEmail);
    });

    it('should return 401 for invalid credentials', async () => {
      const loginData = {
        email: testUserEmail,
        password: 'wrongpassword',
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });
  });
});
