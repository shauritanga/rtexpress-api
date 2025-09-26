#!/usr/bin/env node

// One-time fixer: ensure ADMIN role has permissions:read and permissions:manage
// Usage (from server/):
//   node scripts/grant-admin-permissions.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Ensuring ADMIN has permissions:read and permissions:manage...');
  const admin = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: { isSystemRole: true },
    create: { name: 'ADMIN', isSystemRole: true, description: 'Administrator with full access' },
  });

  const needed = [
    { name: 'permissions:read', resource: 'permissions', action: 'read', description: 'Read permissions' },
    { name: 'permissions:manage', resource: 'permissions', action: 'manage', description: 'Manage permissions' },
    { name: 'admin_portal:access', resource: 'admin_portal', action: 'access', description: 'Access admin portal' },
    { name: 'staff:read', resource: 'staff', action: 'read', description: 'View staff' },
    { name: 'staff:manage', resource: 'staff', action: 'manage', description: 'Manage staff' },
    { name: 'settings:read', resource: 'settings', action: 'read', description: 'View settings' },
    { name: 'settings:manage', resource: 'settings', action: 'manage', description: 'Manage settings' },
  ];

  const created = [];
  for (const p of needed) {
    const perm = await prisma.permission.upsert({
      where: { name: p.name },
      update: { description: p.description },
      create: p,
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: admin.id, permissionId: perm.id } },
      update: {},
      create: { roleId: admin.id, permissionId: perm.id },
    });
    created.push(perm.name);
  }

  console.log('Done. Ensured:', created.join(', '));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

