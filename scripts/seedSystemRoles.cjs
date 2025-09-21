/*
  Seed comprehensive RBAC permissions and system roles.
  Run: node scripts/seedSystemRoles.cjs
*/
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const RESOURCES = {
  admin_portal: ['access'],
  shipments: ['create','read','update','delete','export','status_update','track','approve','manage'],
  bookings: ['create','read','update','delete','export','cancel','manage'],
  customers: ['create','read','update','delete','export','manage'],
  invoices: ['create','read','update','delete','export','send','record_payment','refund','manage'],
  payments: ['read','manage'],
  staff: ['create','read','update','delete','manage'],
  support: ['create','read','update','delete','assign','close','manage'],
  users: ['read','create','update','delete','assign_role','reset_password','suspend','activate','manage'],
  roles: ['read','create','update','delete','assign_permissions','manage'],
  permissions: ['read','create','update','delete','manage'],
  audit_logs: ['read','export','purge','manage'],
  settings: ['read','update','manage'],
};

const DESCRIPTIONS = {
  'admin_portal:access': 'Access Admin Portal',
  'shipments:status_update': 'Update shipment status',
  'shipments:track': 'Track shipments',
  'shipments:approve': 'Approve shipment operations',
  'bookings:cancel': 'Cancel bookings',
  'invoices:send': 'Send invoices to customers',
  'invoices:record_payment': 'Record a payment against an invoice',
  'invoices:refund': 'Record/issue refunds',
  'support:assign': 'Assign support tickets',
  'support:close': 'Close support tickets',
  'users:assign_role': 'Assign roles to users',
  'users:reset_password': 'Reset user passwords',
  'users:suspend': 'Suspend users',
  'users:activate': 'Activate users',
  'roles:assign_permissions': 'Grant/revoke permissions for roles',
  'audit_logs:export': 'Export audit logs',
  'audit_logs:purge': 'Purge audit logs',
};

function buildPermissions() {
  const out = [];
  for (const [resource, actions] of Object.entries(RESOURCES)) {
    for (const action of actions) {
      const name = `${resource}:${action}`;
      out.push({ name, resource, action, description: DESCRIPTIONS[name] || undefined });
    }
  }
  return out;
}

async function ensureSystemRoles() {
  const roles = ['ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER'];
  const map = {};
  for (const name of roles) {
    map[name] = await prisma.role.upsert({
      where: { name },
      update: { isSystemRole: true },
      create: { name, isSystemRole: true, description: `${name} system role` },
    });
  }
  return map;
}

async function upsertPermissions(perms) {
  const map = {};
  for (const p of perms) {
    map[p.name] = await prisma.permission.upsert({
      where: { name: p.name },
      update: { resource: p.resource, action: p.action, description: p.description },
      create: p,
    });
  }
  return map;
}

function pick(names, permMap) {
  return names.map(n => permMap[n]).filter(Boolean);
}

async function assign(roleId, permRecords) {
  const existing = await prisma.rolePermission.findMany({ where: { roleId } });
  const existingSet = new Set(existing.map(rp => rp.permissionId));
  const toCreate = permRecords.filter(p => !existingSet.has(p.id)).map(p => ({ roleId, permissionId: p.id }));
  if (toCreate.length) await prisma.rolePermission.createMany({ data: toCreate, skipDuplicates: true });
}

async function main() {
  const roleRecords = await ensureSystemRoles();
  const allPermsInput = buildPermissions();
  const permMap = await upsertPermissions(allPermsInput);

  // ADMIN gets everything
  await assign(roleRecords.ADMIN.id, Object.values(permMap));

  // MANAGER
  const managerPerms = [
    'admin_portal:access',
    // Operational manage
    'shipments:manage','bookings:manage','customers:manage','invoices:manage','support:manage',
    // Payments visibility
    'payments:read',
    // Admin read-only
    'users:read','roles:read','permissions:read','audit_logs:read','settings:read',
  ];
  await assign(roleRecords.MANAGER.id, pick(managerPerms, permMap));

  // STAFF (operational minimal)
  const staffPerms = [
    'admin_portal:access',
    'shipments:read','shipments:create','shipments:update','shipments:status_update','shipments:track',
    'bookings:read','bookings:create','bookings:update',
    'customers:read',
    'invoices:read',
    'payments:read',
    'support:read','support:create','support:update',
  ];
  await assign(roleRecords.STAFF.id, pick(staffPerms, permMap));

  console.log('RBAC seed complete:', {
    roles: Object.fromEntries(Object.entries(roleRecords).map(([k, v]) => [k, v.id])),
    permissionsCount: Object.keys(permMap).length,
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
