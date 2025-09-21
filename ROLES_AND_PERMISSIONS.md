# 🏷️ RT Express Roles & Permissions System

## 📋 Overview

RT Express uses a comprehensive Role-Based Access Control (RBAC) system with 5 predefined system roles and granular permissions across all resources.

## 👥 System Roles

### 🔴 ADMIN - System Administrator
**Full access to all features and system management**

**Permissions**: 25 permissions across all resources
- ✅ **User Management**: Create, read, update, delete users
- ✅ **Role Management**: Manage roles and permissions  
- ✅ **Customer Management**: Full customer access
- ✅ **Shipment Management**: Complete shipment control
- ✅ **Invoice Management**: Full invoice and payment control
- ✅ **Support Management**: Complete support system access
- ✅ **Booking Management**: Full booking control
- ✅ **System Management**: System administration and audit logs
- ✅ **Notification Management**: Complete notification control

**Use Cases**: System administrators, IT managers, business owners

---

### 🟠 MANAGER - Operations Manager  
**Manage daily operations and supervise staff**

**Permissions**: 18 permissions focused on operations
- ✅ **User Management**: Read and update users (no create/delete)
- ✅ **Customer Management**: Full customer access
- ✅ **Shipment Management**: Complete shipment control
- ✅ **Invoice Management**: Create, update, send invoices, record payments
- ✅ **Support Management**: Handle support tickets and knowledge base
- ✅ **Booking Management**: Manage booking requests
- ✅ **Notifications**: Read, create, update notifications

**Use Cases**: Operations managers, department heads, senior staff

---

### 🟡 STAFF - Staff Member
**Handle shipments and provide customer service**

**Permissions**: 13 permissions for daily operations
- ✅ **Customer Management**: Read and update customer information
- ✅ **Shipment Management**: Create, update, track shipments
- ✅ **Invoice Management**: Create and update invoices (no payment recording)
- ✅ **Support Management**: Handle support tickets
- ✅ **Booking Management**: Read and update bookings
- ✅ **Notifications**: Read and update notifications

**Use Cases**: Warehouse staff, shipping clerks, general employees

---

### 🔵 CUSTOMER_SERVICE - Customer Service Representative
**Handle customer inquiries and support tickets**

**Permissions**: 12 permissions focused on customer support
- ✅ **Customer Management**: Read and update customer information
- ✅ **Shipment Management**: Read, update, and track shipments
- ✅ **Invoice Management**: Read invoices (no modification)
- ✅ **Support Management**: Full support ticket management
- ✅ **Booking Management**: Read and update bookings
- ✅ **Notifications**: Create and manage customer notifications

**Use Cases**: Customer service representatives, support agents, call center staff

---

### 🟢 CUSTOMER - Customer
**Access to own shipments and bookings**

**Permissions**: 8 permissions for self-service
- ✅ **Shipment Management**: View own shipments, create new shipments
- ✅ **Invoice Management**: View own invoices
- ✅ **Support Management**: Create and manage own support tickets
- ✅ **Booking Management**: Create and manage own bookings
- ✅ **Notifications**: View and manage own notifications

**Use Cases**: End customers, clients, external users

---

## 🔐 Permission Structure

### Permission Format
Permissions follow the format: `resource:action`

**Example**: `shipments:create`, `users:manage`, `invoices:read`

### Permission Actions
- **read**: View/list resources
- **create**: Create new resources
- **update**: Modify existing resources  
- **delete**: Remove resources
- **manage**: Full control (includes all above actions)
- **Special actions**: `status_update`, `send`, `record_payment`

### Resources
- **users**: User accounts and profiles
- **roles**: Role and permission management
- **customers**: Customer information and accounts
- **shipments**: Shipment tracking and management
- **invoices**: Invoice generation and payment processing
- **support**: Support tickets and knowledge base
- **bookings**: Booking requests and management
- **system**: System administration and settings
- **notifications**: Notification system
- **audit_logs**: System audit and activity logs

## 🚀 Setup Instructions

### Automatic Setup (Recommended)
Run the complete setup script:
```bash
cd /home/rtexpres/rtexpress-api
./setup-complete.sh
```

This will:
1. Install dependencies
2. Deploy database schema
3. Create all 5 system roles
4. Create 50+ permissions
5. Create admin user
6. Set proper file permissions

### Manual Setup
If you need to set up roles separately:

```bash
# Create roles and permissions
node seed-roles.js

# Create admin user (includes role setup)
node seed-admin.js
```

## 👤 User Management

### Creating Users with Roles

#### Via Admin Panel
1. Login as admin: `https://rtexpress.co.tz/admin`
2. Go to **Users** section
3. Click **Create User**
4. Fill user details and select role
5. User receives email with login credentials

#### Via API
```bash
curl -X POST https://rtexpress.co.tz/api/users \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "manager@rtexpress.co.tz",
    "name": "Operations Manager",
    "roleId": "ROLE_ID_HERE",
    "password": "temporary_password"
  }'
```

### Changing User Roles
```bash
curl -X PATCH https://rtexpress.co.tz/api/users/USER_ID \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleId": "NEW_ROLE_ID"}'
```

## 🔧 Permission Checking

### In Backend Code
```javascript
import { hasPermission } from '../lib/permissions.js';

// Check specific permission
if (await hasPermission(userId, 'shipments:create')) {
  // User can create shipments
}

// Check manage permission (includes all actions)
if (await hasPermission(userId, 'shipments:manage')) {
  // User has full shipment access
}
```

### In Frontend Code
```javascript
// Check user permissions from auth context
const { user, hasPermission } = useAuth();

if (hasPermission('users:create')) {
  // Show create user button
}
```

## 📊 Role Hierarchy

```
ADMIN (Full Access)
  ↓
MANAGER (Operations)
  ↓
STAFF ← → CUSTOMER_SERVICE (Specialized)
  ↓
CUSTOMER (Self-service)
```

## 🎯 Common Use Cases

### Setting Up a New Employee
1. **Warehouse Worker**: Assign `STAFF` role
2. **Customer Support**: Assign `CUSTOMER_SERVICE` role  
3. **Department Manager**: Assign `MANAGER` role
4. **System Admin**: Assign `ADMIN` role

### Permission Examples
- **STAFF** can update shipment status but cannot delete shipments
- **CUSTOMER_SERVICE** can view all invoices but cannot record payments
- **MANAGER** can create users but cannot delete them
- **CUSTOMER** can only see their own data (enforced by business logic)

## 🔒 Security Features

### Built-in Security
- ✅ **JWT Authentication**: Secure token-based auth
- ✅ **Permission Caching**: 5-second cache for performance
- ✅ **Role Inheritance**: `manage` permission includes all actions
- ✅ **Data Isolation**: Customers only see own data
- ✅ **Audit Logging**: Track all permission changes

### Best Practices
1. **Principle of Least Privilege**: Give minimum required permissions
2. **Regular Review**: Audit user roles quarterly
3. **Role Separation**: Don't mix customer service and admin roles
4. **Strong Passwords**: Enforce password policies
5. **Session Management**: Implement proper token expiration

## 🧪 Testing Permissions

### Test Role Access
```bash
# Login as different roles
curl -X POST https://rtexpress.co.tz/api/auth/login \
  -d '{"email":"staff@rtexpress.co.tz","password":"password"}'

# Test permission-protected endpoint
curl -X GET https://rtexpress.co.tz/api/users \
  -H "Authorization: Bearer STAFF_TOKEN"
# Should return 403 Forbidden
```

### Verify Role Setup
```bash
# Check roles were created
curl -X GET https://rtexpress.co.tz/api/roles \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Check user permissions
curl -X GET https://rtexpress.co.tz/api/users/USER_ID/permissions \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

## 📞 Support

### Common Issues
- **Permission Denied**: Check user role and required permissions
- **Role Not Found**: Ensure roles were seeded properly
- **Access Errors**: Verify JWT token and user status

### Troubleshooting
```bash
# Re-seed roles if needed
node seed-roles.js

# Check database for roles
npx prisma studio
# Navigate to Role and Permission tables
```

---

**Your RT Express RBAC system is now ready for production use! 🚀**

The system provides enterprise-grade security with flexible role management suitable for shipping companies of any size.
