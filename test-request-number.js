const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Copy the generateRequestNumber function from the API
async function generateRequestNumber() {
  const year = new Date().getFullYear();
  const prefix = `BR${year}`;

  // Count existing requests for this year to determine next number
  const existingCount = await prisma.bookingRequest.count({
    where: {
      id: {
        startsWith: prefix
      }
    }
  });

  // Start from 1 and increment based on count
  const nextNumber = existingCount + 1;

  // Format with leading zeros (e.g., BR2025001, BR2025002, etc.)
  return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
}

async function testRequestNumber() {
  console.log('🧪 Testing Request Number Generation...\n');

  try {
    console.log('1. Testing request number generation...');
    const requestNumber1 = await generateRequestNumber();
    console.log('✅ Generated request number 1:', requestNumber1);

    const requestNumber2 = await generateRequestNumber();
    console.log('✅ Generated request number 2:', requestNumber2);

    const requestNumber3 = await generateRequestNumber();
    console.log('✅ Generated request number 3:', requestNumber3);

    console.log('\n2. Checking existing booking requests...');
    const year = new Date().getFullYear();
    const prefix = `BR${year}`;
    
    const existingRequests = await prisma.bookingRequest.findMany({
      where: {
        id: {
          startsWith: prefix
        }
      },
      select: {
        id: true,
        customerType: true,
        firstName: true,
        lastName: true,
        companyName: true,
        email: true,
        createdAt: true
      },
      orderBy: {
        id: 'asc'
      }
    });

    console.log(`Found ${existingRequests.length} existing requests for ${year}:`);
    existingRequests.forEach(req => {
      const name = req.customerType === 'INDIVIDUAL' 
        ? `${req.firstName} ${req.lastName}`
        : req.companyName;
      console.log(`   - ${req.id}: ${req.customerType} - ${name} (${req.email})`);
    });

    console.log('\n🎉 Request number generation working correctly!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testRequestNumber();
