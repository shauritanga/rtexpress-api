const { PrismaClient } = require('@prisma/client');
const { z } = require('zod');
const prisma = new PrismaClient();

// Copy the validation schema and generateRequestNumber function
const bookingSchema = z.object({
  customerType: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  firstName: z.string().trim().min(1, 'First name is required').max(60).optional(),
  lastName: z.string().trim().min(1, 'Last name is required').max(60).optional(),
  companyName: z.string().trim().min(1, 'Company name is required').max(120).optional(),
  contactPerson: z.string().trim().min(1, 'Contact person is required').max(120).optional(),
  taxId: z.string().trim().max(50).optional(),
  phone: z.string().trim().min(6, 'Phone is required').max(32),
  email: z.string().trim().email('Valid email is required').max(160),
  street: z.string().trim().min(1, 'Street address is required').max(255).optional(),
  city: z.string().trim().min(1, 'City is required').max(100).optional(),
  state: z.string().trim().max(100).optional(),
  zipCode: z.string().trim().max(20).optional(),
  country: z.string().trim().min(1, 'Country is required').max(100).optional(),
  itemDescription: z.string().trim().min(1, 'Item description is required').max(1000),
  pickupLocation: z.string().trim().min(1, 'Pickup location is required').max(255),
  deliveryLocation: z.string().trim().min(1, 'Delivery location is required').max(255),
  notes: z.string().trim().max(1000).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
}).refine((data) => {
  if (data.customerType === 'INDIVIDUAL') {
    return data.firstName && data.lastName;
  } else if (data.customerType === 'BUSINESS') {
    return data.companyName && data.contactPerson;
  }
  return false;
}, {
  message: 'Required fields missing for selected customer type',
  path: ['customerType']
});

async function generateRequestNumber() {
  const year = new Date().getFullYear();
  const prefix = `BR${year}`;
  const existingCount = await prisma.bookingRequest.count({
    where: { id: { startsWith: prefix } }
  });
  const nextNumber = existingCount + 1;
  return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
}

async function testFullBooking() {
  console.log('🧪 Testing Full Booking Creation Process...\n');

  try {
    // Test INDIVIDUAL booking
    console.log('1. Testing INDIVIDUAL booking creation...');
    
    const individualData = {
      customerType: 'INDIVIDUAL',
      firstName: 'Test',
      lastName: 'Individual',
      phone: '+255111111111',
      email: 'test.individual.full@example.com',
      street: '123 Full Test Street',
      city: 'Dar es Salaam',
      state: 'Dar es Salaam',
      zipCode: '12345',
      country: 'Tanzania',
      itemDescription: 'Full test package individual',
      pickupLocation: 'Dar es Salaam, Tanzania',
      deliveryLocation: 'Arusha, Tanzania',
      notes: 'Full test individual booking',
      consent: true
    };

    // Validate
    const individualParsed = bookingSchema.safeParse(individualData);
    if (!individualParsed.success) {
      console.log('❌ Individual validation failed:', individualParsed.error.issues);
      return;
    }
    console.log('✅ Individual validation passed');

    // Generate request number
    const individualRequestNumber = await generateRequestNumber();
    console.log('✅ Individual request number generated:', individualRequestNumber);

    // Create booking
    const individualBooking = await prisma.bookingRequest.create({
      data: {
        id: individualRequestNumber,
        ...individualParsed.data,
        consentAt: new Date()
      }
    });
    console.log('✅ Individual booking created:', individualBooking.id);

    // Test BUSINESS booking
    console.log('\n2. Testing BUSINESS booking creation...');
    
    const businessData = {
      customerType: 'BUSINESS',
      companyName: 'Full Test Corp Ltd',
      contactPerson: 'Test Business Person',
      taxId: 'TIN-FULLTEST123',
      phone: '+255222222222',
      email: 'test.business.full@example.com',
      street: '456 Full Test Business Avenue',
      city: 'Mwanza',
      state: 'Mwanza',
      zipCode: '54321',
      country: 'Tanzania',
      itemDescription: 'Full test package business',
      pickupLocation: 'Mwanza, Tanzania',
      deliveryLocation: 'Dodoma, Tanzania',
      notes: 'Full test business booking',
      consent: true
    };

    // Validate
    const businessParsed = bookingSchema.safeParse(businessData);
    if (!businessParsed.success) {
      console.log('❌ Business validation failed:', businessParsed.error.issues);
      return;
    }
    console.log('✅ Business validation passed');

    // Generate request number
    const businessRequestNumber = await generateRequestNumber();
    console.log('✅ Business request number generated:', businessRequestNumber);

    // Create booking
    const businessBooking = await prisma.bookingRequest.create({
      data: {
        id: businessRequestNumber,
        ...businessParsed.data,
        consentAt: new Date()
      }
    });
    console.log('✅ Business booking created:', businessBooking.id);

    console.log('\n🎉 Full booking creation process working correctly!');
    console.log(`Individual Booking: ${individualBooking.id}`);
    console.log(`Business Booking: ${businessBooking.id}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
  } finally {
    await prisma.$disconnect();
  }
}

testFullBooking();
