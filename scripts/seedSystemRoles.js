/*
  Seed system roles and baseline permissions for dynamic RBAC
  Run: node scripts/seedSystemRoles.js
*/
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // Upsert system roles
  const roles = ['ADMIN', 'STAFF', 'CUSTOMER'];
  const roleRecords = {};
  for (const name of roles) {
    roleRecords[name] = await prisma.role.upsert({
      where: { name },
      update: { isSystemRole: true },
      create: { name, isSystemRole: true, description: `${name} system role` },
    });
  }

  // Baseline permissions
  const basePerms = [
    { name: 'admin:access', resource: 'admin', action: 'access', description: 'Access admin portal' },
    { name: 'roles:manage', resource: 'roles', action: 'manage', description: 'Manage roles' },
    { name: 'permissions:manage', resource: 'permissions', action: 'manage', description: 'Manage permissions' },
    { name: 'users:manage', resource: 'users', action: 'manage', description: 'Manage users' },
  ];

  const permMap = {};
  for (const p of basePerms) {
    permMap[p.name] = await prisma.permission.upsert({
      where: { name: p.name },
      update: { description: p.description },
      create: p,
    });
  }

  // Ensure ADMIN has baseline permissions
  const adminId = roleRecords.ADMIN.id;
  const adminRolePerms = await prisma.rolePermission.findMany({ where: { roleId: adminId } });
  const existing = new Set(adminRolePerms.map(rp => rp.permissionId));
  const toCreate = Object.values(permMap)
    .filter(perm => !existing.has(perm.id))
    .map(perm => ({ roleId: adminId, permissionId: perm.id }));
  if (toCreate.length) {
    await prisma.rolePermission.createMany({ data: toCreate, skipDuplicates: true });
  }

  console.log('Seed complete:', {
    roles: Object.fromEntries(Object.entries(roleRecords).map(([k, v]) => [k, v.id])),
    permissions: Object.fromEntries(Object.entries(permMap).map(([k, v]) => [k, v.id])),
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

