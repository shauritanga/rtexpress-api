# 👤 Admin User Setup for RT Express

## 🎯 Admin Credentials

**Email**: `admin@rtexpress.co.tz`  
**Password**: `admin123`  
**Role**: System Administrator  

## 🚀 Quick Setup Methods

### Method 1: Automatic (Recommended)
The admin user is created automatically when you run the setup script:

```bash
cd /home/rtexpres/rtexpress-api
./setup.sh
```

The setup script will:
1. Install dependencies
2. Setup database
3. **Create admin user automatically**
4. Display login credentials

### Method 2: Manual Creation
If you need to create the admin user manually:

```bash
cd /home/rtexpres/rtexpress-api
node seed-admin.js
```

### Method 3: Using the Helper Script
```bash
cd /home/rtexpres/rtexpress-api
./create-admin.sh
```

## 📋 What Gets Created

### Admin User
- **Email**: admin@rtexpress.co.tz
- **Password**: admin123 (hashed with bcrypt)
- **Name**: RT Express Administrator
- **Status**: ACTIVE
- **Email Verified**: true

### Admin Role & Permissions
The script creates a complete admin role with permissions for:

- ✅ **User Management**: Create, read, update, delete users
- ✅ **Role Management**: Manage roles and permissions
- ✅ **Customer Management**: Full customer access
- ✅ **Shipment Management**: Track, update, manage shipments
- ✅ **Invoice Management**: Create, send, manage invoices
- ✅ **Support Management**: Handle tickets and knowledge base
- ✅ **Booking Management**: Manage booking requests
- ✅ **System Management**: System administration
- ✅ **Notification Management**: Manage notification system

## 🔗 Access Points

### Admin Portal
- **URL**: `https://rtexpress.co.tz/admin`
- **Login**: `https://rtexpress.co.tz/login`

### First Login Steps
1. Go to `https://rtexpress.co.tz/login`
2. Enter email: `admin@rtexpress.co.tz`
3. Enter password: `admin123`
4. Click "Sign In"
5. You'll be redirected to the admin dashboard

## 🔒 Security Recommendations

### ⚠️ IMPORTANT: Change Default Password
After first login:
1. Go to **Profile** or **Settings**
2. Change password from `admin123` to a strong password
3. Use a password manager
4. Enable 2FA if available

### Strong Password Guidelines
- At least 12 characters
- Mix of uppercase, lowercase, numbers, symbols
- Avoid common words or patterns
- Example: `RTExpr3ss@2025!Adm1n`

## 🧪 Testing Admin Access

### Test Login
```bash
# Test API health
curl https://rtexpress.co.tz/api/health

# Test login (replace with your domain)
curl -X POST https://rtexpress.co.tz/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rtexpress.co.tz","password":"admin123"}'
```

### Test Admin Features
1. **Dashboard**: View system metrics
2. **Users**: Manage user accounts
3. **Customers**: View customer list
4. **Shipments**: Track shipments
5. **Invoices**: Generate invoices
6. **Support**: Handle tickets
7. **Notifications**: View notification system

## 🔍 Troubleshooting

### Admin User Already Exists
```
✅ Admin user already exists!
   Email: admin@rtexpress.co.tz
   Name: RT Express Administrator
   Role: ADMIN
   Status: ACTIVE
```
This is normal - the script detects existing users.

### Database Connection Error
```
❌ Error: Cannot connect to database
```
**Solution**: Check your `DATABASE_URL` in `.env` file.

### Permission Denied
```
❌ Error: Permission denied
```
**Solution**: Make sure you're in the API directory and have proper file permissions.

### Login Not Working
1. **Check API**: Ensure Node.js app is running
2. **Check Database**: Verify user was created
3. **Check CORS**: Ensure frontend can reach API
4. **Check Logs**: Look at application logs

## 📊 Admin Dashboard Features

Once logged in, you'll have access to:

### 📈 **Dashboard**
- System metrics and analytics
- Recent activity overview
- Quick action buttons

### 👥 **User Management**
- View all users
- Create new staff accounts
- Manage roles and permissions
- User activity logs

### 🚚 **Shipment Management**
- Track all shipments
- Update shipment status
- Generate shipping labels
- Delivery management

### 💰 **Financial Management**
- Invoice generation
- Payment tracking
- Financial reports
- Revenue analytics

### 🎫 **Support System**
- Ticket management
- Knowledge base
- Canned responses
- SLA monitoring

### 🔔 **Notification System**
- Real-time notifications
- Notification history
- System alerts
- User notifications

## 🎉 Success Indicators

After successful admin setup:
- ✅ Can login at `/login`
- ✅ Redirected to `/admin` dashboard
- ✅ Can access all admin features
- ✅ Notification bell shows unread count
- ✅ Can create/manage users
- ✅ Can view system metrics

## 📞 Support

If you encounter issues:
1. Check the setup logs
2. Verify database connection
3. Ensure Node.js app is running
4. Check browser console for errors
5. Review API logs in cPanel

---

**Your RT Express admin account is ready! 🚀**

Remember to change the default password after your first login for security.
