require('dotenv/config');
const { prisma } = require('../src/lib/prisma');
const bcrypt = require('bcryptjs');

async function main() {
  // First, ensure roles exist
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Administrator with full access' },
  });

  const staffRole = await prisma.role.upsert({
    where: { name: 'STAFF' },
    update: {},
    create: { name: 'STAFF', description: 'Staff member with limited access' },
  });

  const customerRole = await prisma.role.upsert({
    where: { name: 'CUSTOMER' },
    update: {},
    create: { name: 'CUSTOMER', description: 'Customer with portal access' },
  });

  // Create base users
  const adminPass = await bcrypt.hash('admin123', 10);
  const staffPass = await bcrypt.hash('staff123', 10);
  const customerPass = await bcrypt.hash('customer123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@rtexpress.com' },
    update: {},
    create: {
      email: 'admin@rtexpress.com',
      passwordHash: adminPass,
      name: 'Admin User',
      roleId: adminRole.id
    },
  });
  const staff = await prisma.user.upsert({
    where: { email: 'staff@rtexpress.com' },
    update: {},
    create: {
      email: 'staff@rtexpress.com',
      passwordHash: staffPass,
      name: 'Staff User',
      roleId: staffRole.id
    },
  });
  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@rtexpress.com' },
    update: {},
    create: {
      email: 'customer@rtexpress.com',
      passwordHash: customerPass,
      name: 'Customer Demo',
      roleId: customerRole.id
    },
  });

  // Create a customer profile owned by the customer user
  const customer = await prisma.customer.upsert({
    where: { email: 'customer@rtexpress.com' },
    update: {},
    create: {
      email: 'customer@rtexpress.com',
      customerNumber: 1001,
      type: 'INDIVIDUAL',
      firstName: 'Customer',
      lastName: 'Demo',
      preferredCurrency: 'TZS',
      city: 'Dar es Salaam',
      country: 'Tanzania',
      ownerId: customerUser.id,
    },
  });

  // Create sample shipments
  const shipment1 = await prisma.shipment.create({
    data: {
      trackingNumber: 'RT2024001',
      customerId: customer.id,
      status: 'IN_TRANSIT',
      origin: 'Dar es Salaam',
      destination: 'Arusha',
      description: 'Express delivery package',
      packageType: 'PACKAGE',
      weight: 5.5,
      dimensions: '30x20x15',
      declaredValue: 50000,
      currency: 'TZS',
      serviceType: 'EXPRESS',
      estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
    },
  });

  const shipment2 = await prisma.shipment.create({
    data: {
      trackingNumber: 'RT2024002',
      customerId: customer.id,
      status: 'DELIVERED',
      origin: 'Mwanza',
      destination: 'Dar es Salaam',
      description: 'Standard delivery package',
      packageType: 'PACKAGE',
      weight: 2.0,
      dimensions: '20x15x10',
      declaredValue: 25000,
      currency: 'TZS',
      serviceType: 'STANDARD',
      deliveredAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    },
  });

  // Create sample invoices
  const invoice1 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-202401-C001',
      customerId: customer.id,
      status: 'sent',
      subtotal: 150000,
      taxAmount: 27000,
      total: 177000,
      currency: 'TZS',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      items: [
        {
          description: 'Express Shipping - Dar to Arusha',
          quantity: 1,
          unitPrice: 150000,
          total: 150000,
        },
      ],
    },
  });

  console.log('Database seeded successfully!');
  console.log('Created users:');
  console.log('- Admin: admin@rtexpress.com / admin123');
  console.log('- Staff: staff@rtexpress.com / staff123');
  console.log('- Customer: customer@rtexpress.com / customer123');
  console.log('Created sample data:');
  console.log(`- Customer: ${customer.customerNumber}`);
  console.log(`- Shipments: ${shipment1.trackingNumber}, ${shipment2.trackingNumber}`);
  console.log(`- Invoice: ${invoice1.invoiceNumber}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
