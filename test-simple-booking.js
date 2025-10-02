const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testSimpleBooking() {
  console.log('🧪 Testing Simple Booking Creation...\n');

  try {
    // Check the booking that was created
    console.log('1. Checking recent bookings...');
    const recentBookings = await prisma.bookingRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    console.log(`Found ${recentBookings.length} recent bookings:`);
    recentBookings.forEach(booking => {
      const customerName = booking.customerType === 'INDIVIDUAL' 
        ? `${booking.firstName} ${booking.lastName}`
        : `${booking.companyName} (Contact: ${booking.contactPerson})`;
      
      console.log(`   - ${booking.id}: ${booking.customerType} - ${customerName || 'N/A'}`);
      console.log(`     Email: ${booking.email}, Phone: ${booking.phone}`);
      if (booking.street) {
        console.log(`     Address: ${booking.street}, ${booking.city}, ${booking.country}`);
      }
      console.log('');
    });

    // Test direct database creation
    console.log('2. Testing direct database creation...');
    
    // Generate a proper request number
    const year = new Date().getFullYear();
    const existingCount = await prisma.bookingRequest.count({
      where: {
        id: {
          startsWith: `BR${year}`
        }
      }
    });
    const nextNumber = (existingCount + 1).toString().padStart(3, '0');
    const requestNumber = `BR${year}${nextNumber}`;

    const testBooking = await prisma.bookingRequest.create({
      data: {
        id: requestNumber,
        customerType: 'BUSINESS',
        companyName: 'Test Direct Corp',
        contactPerson: 'Direct Test Person',
        taxId: 'TIN-DIRECT123',
        phone: '+255999888777',
        email: 'direct.test@example.com',
        street: '789 Direct Street',
        city: 'Dodoma',
        state: 'Dodoma',
        zipCode: '11111',
        country: 'Tanzania',
        itemDescription: 'Direct test package',
        pickupLocation: 'Dodoma, Tanzania',
        deliveryLocation: 'Mbeya, Tanzania',
        notes: 'Direct database test',
        consent: true,
        consentAt: new Date(),
      },
    });

    console.log('✅ Direct booking created:', testBooking.id);
    console.log(`   Company: ${testBooking.companyName}`);
    console.log(`   Contact: ${testBooking.contactPerson}`);
    console.log(`   Email: ${testBooking.email}`);

    console.log('\n🎉 Database operations working correctly!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSimpleBooking();
