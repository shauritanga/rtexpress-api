import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  // Create base users
  const adminPass = await bcrypt.hash('admin123', 10);
  const staffPass = await bcrypt.hash('staff123', 10);
  const customerPass = await bcrypt.hash('customer123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@rtexpress.com' },
    update: {},
    create: { email: 'admin@rtexpress.com', passwordHash: adminPass, name: 'Admin User', role: 'ADMIN' },
  });
  const staff = await prisma.user.upsert({
    where: { email: 'staff@rtexpress.com' },
    update: {},
    create: { email: 'staff@rtexpress.com', passwordHash: staffPass, name: 'Staff User', role: 'STAFF' },
  });
  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@rtexpress.com' },
    update: {},
    create: { email: 'customer@rtexpress.com', passwordHash: customerPass, name: 'Customer Demo', role: 'CUSTOMER' },
  });

  // Create a customer profile owned by the customer user
  const customer = await prisma.customer.upsert({
    where: { email: 'customer@rtexpress.com' },
    update: {},
    create: {
      email: 'customer@rtexpress.com',
      customerNumber: 'CUST001',
      type: 'INDIVIDUAL',
      firstName: 'Customer',
      lastName: 'Demo',
      preferredCurrency: 'TZS',
      city: 'Dar es Salaam',
      country: 'Tanzania',
      ownerId: customerUser.id,
    },
  });

  // Invoices (TZS)
  const inv1 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-202401-C001',
      customerId: customer.id,
      status: 'sent',
      subtotal: 150000,
      taxAmount: 27000,
      discountAmount: 0,
      totalAmount: 177000,
      paidAmount: 0,
      balanceAmount: 177000,
      currency: 'TZS',
      issueDate: new Date('2024-01-15'),
      dueDate: new Date('2024-02-15'),
      items: { create: [{ description: 'Express Shipping', quantity: 1, unitPrice: 150000, total: 150000 }] },
    },
  });
  const inv2 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-202401-C002',
      customerId: customer.id,
      status: 'paid',
      subtotal: 135000,
      taxAmount: 24300,
      discountAmount: 10000,
      totalAmount: 149300,
      paidAmount: 149300,
      balanceAmount: 0,
      currency: 'TZS',
      issueDate: new Date('2024-01-10'),
      dueDate: new Date('2024-02-10'),
      items: { create: [{ description: 'Standard Shipping', quantity: 1, unitPrice: 135000, total: 135000 }] },
    },
  });
  const inv3 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-202401-C003',
      customerId: customer.id,
      status: 'overdue',
      subtotal: 200000,
      taxAmount: 36000,
      discountAmount: 0,
      totalAmount: 236000,
      paidAmount: 100000,
      balanceAmount: 136000,
      currency: 'TZS',
      issueDate: new Date('2024-01-05'),
      dueDate: new Date('2024-01-20'),
      items: { create: [{ description: 'Express + Insurance', quantity: 1, unitPrice: 200000, total: 200000 }] },
    },
  });

  // Shipments (TZS values)
  await prisma.shipment.createMany({
    data: [
      {
        trackingNumber: 'RT2024010001',
        customerId: customer.id,
        description: 'Electronics - Laptop',
        packageType: 'Package',
        weightValue: 2.5,
        weightUnit: 'kg',
        length: 40,
        width: 30,
        height: 8,
        dimensionUnit: 'cm',
        value: 2500000,
        currency: 'TZS',
        priority: 'Express',
        status: 'In Transit',
        originStreet: '123 Demo Street',
        originCity: 'Dar es Salaam',
        originState: 'Dar es Salaam',
        originZip: '12345',
        originCountry: 'Tanzania',
        destStreet: '456 Delivery Avenue',
        destCity: 'Mwanza',
        destState: 'Mwanza',
        destZip: '67890',
        destCountry: 'Tanzania',
        estimatedDelivery: new Date('2024-01-18T15:00:00Z'),
        signatureRequired: true,
        insuranceValue: 2500000,
      },
      {
        trackingNumber: 'RT2024010002',
        customerId: customer.id,
        description: 'Business Documents',
        packageType: 'Document',
        weightValue: 0.5,
        weightUnit: 'kg',
        length: 30,
        width: 20,
        height: 2,
        dimensionUnit: 'cm',
        value: 50000,
        currency: 'TZS',
        priority: 'Standard',
        status: 'Delivered',
        originStreet: '123 Demo Street',
        originCity: 'Dar es Salaam',
        originState: 'Dar es Salaam',
        originZip: '12345',
        originCountry: 'Tanzania',
        destStreet: '789 Business Center',
        destCity: 'Dodoma',
        destState: 'Dodoma',
        destZip: '54321',
        destCountry: 'Tanzania',
        estimatedDelivery: new Date('2024-01-12T12:00:00Z'),
        actualDelivery: new Date('2024-01-12T11:30:00Z'),
        signatureRequired: true,
        insuranceValue: 50000,
      },
      {
        trackingNumber: 'RT2024010003',
        customerId: customer.id,
        description: 'Gift Package - Clothing',
        packageType: 'Package',
        weightValue: 1.2,
        weightUnit: 'kg',
        length: 35,
        width: 25,
        height: 10,
        dimensionUnit: 'cm',
        value: 150000,
        currency: 'TZS',
        priority: 'Standard',
        status: 'Pending',
        originStreet: '123 Demo Street',
        originCity: 'Dar es Salaam',
        originState: 'Dar es Salaam',
        originZip: '12345',
        originCountry: 'Tanzania',
        destStreet: '321 Home Street',
        destCity: 'Arusha',
        destState: 'Arusha',
        destZip: '98765',
        destCountry: 'Tanzania',
        estimatedDelivery: new Date('2024-01-20T16:00:00Z'),
        signatureRequired: false,
        insuranceValue: 150000,
      },
    ],
  });

  console.log('Seed complete');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });

