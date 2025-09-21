#!/usr/bin/env node
/*
  Bootstrap an admin user.
  Usage:
    node scripts/bootstrapAdmin.cjs --email admin@example.com --name "Admin User" --password "StrongPass123!"
  Or via env vars:
    ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... node scripts/bootstrapAdmin.cjs
*/

const path = require('path');
const fs = require('fs');

// Load env from server/.env if present
try {
  const dotenvPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath });
  } else {
    require('dotenv').config();
  }
} catch (_) {}

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = { email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME, password: process.env.ADMIN_PASSWORD };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--email' || a === '-e') && argv[i + 1]) { args.email = argv[++i]; continue; }
    if ((a === '--name' || a === '-n') && argv[i + 1]) { args.name = argv[++i]; continue; }
    if ((a === '--password' || a === '-p') && argv[i + 1]) { args.password = argv[++i]; continue; }
  }
  return args;
}

(async () => {
  const { email, name, password } = parseArgs(process.argv);
  if (!email || !name || !password) {
    console.error('Missing required inputs. Provide --email, --name and --password or set ADMIN_EMAIL/ADMIN_NAME/ADMIN_PASSWORD.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    // Ensure baseline roles/permissions exist (idempotent)
    const seedPath = path.resolve(__dirname, 'seedSystemRoles.cjs');
    if (fs.existsSync(seedPath)) {
      const res = spawnSync(process.execPath, [seedPath], { stdio: 'inherit', env: process.env });
      if (res.status !== 0) {
        console.warn('Warning: seedSystemRoles script exited with non-zero status. Proceeding anyway.');
      }
    }

    const emailLc = String(email).toLowerCase();
    const adminRole = await prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: {},
      create: { name: 'ADMIN', description: 'System Administrator', isSystemRole: true },
    });

    const passwordHash = await bcrypt.hash(password, 10);

    const existing = await prisma.user.findUnique({ where: { email: emailLc } });
    let user;
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          email: emailLc,
          name,
          passwordHash,
          status: 'ACTIVE',
          otpEnabled: true,
          role: { connect: { id: adminRole.id } },
        },
      });
      console.log(`Promoted existing user to ADMIN: ${user.email}`);
    } else {
      user = await prisma.user.create({
        data: {
          email: emailLc,
          name,
          passwordHash,
          status: 'ACTIVE',
          otpEnabled: true,
          role: { connect: { id: adminRole.id } },
        },
      });
      console.log(`Created ADMIN user: ${user.email}`);
    }

    console.log('Done. You can now login with the provided credentials. OTP will be emailed/logged depending on SMTP config.');
  } catch (err) {
    console.error('Bootstrap admin failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();

