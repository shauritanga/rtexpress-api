const { z } = require('zod');

// Copy the validation schema from the API
const bookingSchema = z.object({
  // Customer type and basic info
  customerType: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  
  // Individual customer fields
  firstName: z.string().trim().min(1, 'First name is required').max(60).optional(),
  lastName: z.string().trim().min(1, 'Last name is required').max(60).optional(),
  
  // Business customer fields
  companyName: z.string().trim().min(1, 'Company name is required').max(120).optional(),
  contactPerson: z.string().trim().min(1, 'Contact person is required').max(120).optional(),
  taxId: z.string().trim().max(50).optional(),
  
  // Common contact information
  phone: z.string().trim().min(6, 'Phone is required').max(32),
  email: z.string().trim().email('Valid email is required').max(160),
  
  // Address information
  street: z.string().trim().min(1, 'Street address is required').max(255).optional(),
  city: z.string().trim().min(1, 'City is required').max(100).optional(),
  state: z.string().trim().max(100).optional(),
  zipCode: z.string().trim().max(20).optional(),
  country: z.string().trim().min(1, 'Country is required').max(100).optional(),
  
  // Shipment details
  itemDescription: z.string().trim().min(1, 'Item description is required').max(1000),
  pickupLocation: z.string().trim().min(1, 'Pickup location is required').max(255),
  deliveryLocation: z.string().trim().min(1, 'Delivery location is required').max(255),
  notes: z.string().trim().max(1000).optional(),
  
  // System fields
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
}).refine((data) => {
  // Validate based on customer type
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

async function testValidation() {
  console.log('🧪 Testing Validation Schema...\n');

  // Test INDIVIDUAL data
  const individualData = {
    customerType: 'INDIVIDUAL',
    firstName: 'John',
    lastName: 'Doe',
    phone: '+255123456789',
    email: 'john.doe.test@example.com',
    street: '123 Test Street',
    city: 'Dar es Salaam',
    state: 'Dar es Salaam',
    zipCode: '12345',
    country: 'Tanzania',
    itemDescription: 'Test package',
    pickupLocation: 'Dar es Salaam, Tanzania',
    deliveryLocation: 'Arusha, Tanzania',
    notes: 'Test notes',
    consent: true
  };

  console.log('1. Testing INDIVIDUAL validation...');
  const individualResult = bookingSchema.safeParse(individualData);
  if (individualResult.success) {
    console.log('✅ Individual validation passed');
    console.log('Parsed data:', JSON.stringify(individualResult.data, null, 2));
  } else {
    console.log('❌ Individual validation failed');
    console.log('Errors:', individualResult.error.issues);
  }

  // Test BUSINESS data
  const businessData = {
    customerType: 'BUSINESS',
    companyName: 'Test Corp Ltd',
    contactPerson: 'Jane Smith',
    taxId: 'TIN-123456789',
    phone: '+255987654321',
    email: 'jane.smith.test@example.com',
    street: '456 Business Avenue',
    city: 'Mwanza',
    state: 'Mwanza',
    zipCode: '54321',
    country: 'Tanzania',
    itemDescription: 'Business test package',
    pickupLocation: 'Mwanza, Tanzania',
    deliveryLocation: 'Dodoma, Tanzania',
    notes: 'Business test notes',
    consent: true
  };

  console.log('\n2. Testing BUSINESS validation...');
  const businessResult = bookingSchema.safeParse(businessData);
  if (businessResult.success) {
    console.log('✅ Business validation passed');
    console.log('Parsed data:', JSON.stringify(businessResult.data, null, 2));
  } else {
    console.log('❌ Business validation failed');
    console.log('Errors:', businessResult.error.issues);
  }

  console.log('\n🎉 Validation testing completed!');
}

testValidation();
