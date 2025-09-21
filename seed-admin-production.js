#!/usr/bin/env node

/**
 * Production Admin User Seeder
 * Creates admin user: admin@rtexpress.co.tz / admin123
 * 
 * Usage:
 * node seed-admin-production.js
 * 
 * Or from API directory:
 * node ../seed-admin-production.js
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

async function seedAdminUser() {
  console.log('🌱 Seeding admin user for production...');

  try {
    // Admin user details
    const adminEmail = 'admin@rtexpress.co.tz';
    const adminPassword = 'admin123';
    const adminName = 'Administrator';

    // Check if admin user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: adminEmail }
    });

    if (existingUser) {
      console.log('⚠️  Admin user already exists:', adminEmail);
      console.log('   User ID:', existingUser.id);
      console.log('   Name:', existingUser.name);
      console.log('   Status:', existingUser.status);
      return;
    }

    // Ensure ADMIN role exists
    console.log('🔧 Creating/updating ADMIN role...');
    const adminRole = await prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: { 
        description: 'System Administrator with full access',
        isSystemRole: true 
      },
      create: {
        name: 'ADMIN',
        description: 'System Administrator with full access',
        isSystemRole: true
      }
    });

    console.log('✅ ADMIN role ready:', adminRole.id);

    // Create admin permissions if they don't exist
    console.log('🔧 Setting up admin permissions...');
    
    const adminPermissions = [
      // User management
      { resource: 'users', action: 'read' },
      { resource: 'users', action: 'create' },
      { resource: 'users', action: 'update' },
      { resource: 'users', action: 'delete' },
      { resource: 'users', action: 'manage' },
      
      // Role management
      { resource: 'roles', action: 'read' },
      { resource: 'roles', action: 'create' },
      { resource: 'roles', action: 'update' },
      { resource: 'roles', action: 'delete' },
      { resource: 'roles', action: 'manage' },
      
      // Customer management
      { resource: 'customers', action: 'read' },
      { resource: 'customers', action: 'create' },
      { resource: 'customers', action: 'update' },
      { resource: 'customers', action: 'delete' },
      { resource: 'customers', action: 'manage' },
      
      // Shipment management
      { resource: 'shipments', action: 'read' },
      { resource: 'shipments', action: 'create' },
      { resource: 'shipments', action: 'update' },
      { resource: 'shipments', action: 'delete' },
      { resource: 'shipments', action: 'status_update' },
      { resource: 'shipments', action: 'manage' },
      
      // Invoice management
      { resource: 'invoices', action: 'read' },
      { resource: 'invoices', action: 'create' },
      { resource: 'invoices', action: 'update' },
      { resource: 'invoices', action: 'delete' },
      { resource: 'invoices', action: 'send' },
      { resource: 'invoices', action: 'record_payment' },
      { resource: 'invoices', action: 'manage' },
      
      // Support management
      { resource: 'support', action: 'read' },
      { resource: 'support', action: 'create' },
      { resource: 'support', action: 'update' },
      { resource: 'support', action: 'delete' },
      { resource: 'support', action: 'manage' },
      
      // Booking management
      { resource: 'bookings', action: 'read' },
      { resource: 'bookings', action: 'create' },
      { resource: 'bookings', action: 'update' },
      { resource: 'bookings', action: 'delete' },
      { resource: 'bookings', action: 'manage' },
      
      // System management
      { resource: 'system', action: 'read' },
      { resource: 'system', action: 'manage' },
      { resource: 'audit_logs', action: 'read' },
      { resource: 'audit_logs', action: 'manage' },
      
      // Notification management
      { resource: 'notifications', action: 'read' },
      { resource: 'notifications', action: 'create' },
      { resource: 'notifications', action: 'update' },
      { resource: 'notifications', action: 'delete' },
      { resource: 'notifications', action: 'manage' }
    ];

    // Create permissions and assign to admin role
    for (const perm of adminPermissions) {
      const permissionName = `${perm.resource}:${perm.action}`;
      const permission = await prisma.permission.upsert({
        where: {
          name: permissionName
        },
        update: {},
        create: {
          name: permissionName,
          resource: perm.resource,
          action: perm.action,
          description: `${perm.action} access to ${perm.resource}`
        }
      });

      // Assign permission to admin role
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: adminRole.id,
          permissionId: permission.id
        }
      });
    }

    console.log(`✅ Created ${adminPermissions.length} permissions for admin role`);

    // Hash password
    console.log('🔐 Hashing password...');
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    // Create admin user
    console.log('👤 Creating admin user...');
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: adminName,
        role: {
          connect: {
            id: adminRole.id
          }
        },
        status: 'ACTIVE'
      }
    });

    console.log('🎉 Admin user created successfully!');
    console.log('');
    console.log('📋 Admin User Details:');
    console.log('   Email:', adminEmail);
    console.log('   Password:', adminPassword);
    console.log('   Name:', adminName);
    console.log('   User ID:', adminUser.id);
    console.log('   Role ID:', adminRole.id);
    console.log('   Status:', adminUser.status);
    console.log('');
    console.log('🔗 Login URLs:');
    console.log('   Admin Portal: https://rtexpress.co.tz/admin');
    console.log('   Login Page: https://rtexpress.co.tz/login');
    console.log('');
    console.log('⚠️  IMPORTANT: Change the default password after first login!');

  } catch (error) {
    console.error('❌ Error seeding admin user:', error);
    
    if (error.code === 'P2002') {
      console.log('💡 This usually means the user already exists.');
    } else if (error.code === 'P2025') {
      console.log('💡 Database schema might not be deployed. Run: npx prisma migrate deploy');
    } else {
      console.log('💡 Check your database connection and schema.');
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeder
seedAdminUser()
  .then(() => {
    console.log('✅ Seeding completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  });
