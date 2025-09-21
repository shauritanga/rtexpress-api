# 🚀 Quick Setup Guide: API Outside public_html

## ✅ You're Right! This Approach is Much Better

Putting the API outside `public_html` is the **recommended best practice** because:
- ✅ **No permission conflicts** with .htaccess
- ✅ **Better security** (API code not web-accessible)
- ✅ **Clean separation** of frontend and backend
- ✅ **Industry standard** deployment pattern

---

## 📦 New Optimized Package Created

**File**: `rt-express-optimized-deployment.zip` (1.04 MB)

### Package Structure:
```
rt-express-optimized-deployment.zip
├── frontend/              # → Upload to public_html/
│   ├── index.html
│   ├── assets/
│   └── .htaccess
├── api/                   # → Upload to /home/rtexpres/rtexpress-api/
│   ├── index.js
│   ├── package.json
│   ├── .env
│   ├── setup.sh          # Automated setup script
│   └── prisma/
└── DEPLOYMENT_INSTRUCTIONS.md
```

---

## 🎯 Super Quick Setup (5 Steps)

### Step 1: Create API Directory
```bash
mkdir -p /home/rtexpres/rtexpress-api
```

### Step 2: Upload Files
- **Frontend**: Upload `frontend/` contents → `/home/rtexpres/domains/rtexpress.co.tz/public_html/`
- **API**: Upload `api/` contents → `/home/rtexpres/rtexpress-api/`

### Step 3: Run Setup Script
```bash
cd /home/rtexpres/rtexpress-api
chmod +x setup.sh
./setup.sh
```

### Step 4: Create Node.js App in cPanel
1. Go to **Node.js** in cPanel
2. Click **Create Application**
3. Fill in:
   - **Application Root**: `/home/rtexpres/rtexpress-api`
   - **Application URL**: `api.rtexpress.co.tz` (create subdomain)
   - **Startup File**: `index.js`
   - **Node.js Version**: 18+ (latest available)

### Step 5: Update Environment & Start
```bash
# Edit environment file
nano /home/rtexpres/rtexpress-api/.env

# Update these values:
DATABASE_URL="mysql://rtexpres_user:password@localhost:3306/rtexpres_db"
CORS_ORIGIN=https://rtexpress.co.tz
API_BASE_URL=https://api.rtexpress.co.tz
```

Then click **Start** in the Node.js app interface.

---

## 🔧 Environment Configuration

Update `/home/rtexpres/rtexpress-api/.env`:

```env
# Database (update with your cPanel MySQL details)
DATABASE_URL="mysql://rtexpres_user:your_password@localhost:3306/rtexpres_rtexpress"

# JWT Secrets (generate strong random strings)
JWT_ACCESS_SECRET=your-super-strong-access-secret-here
JWT_REFRESH_SECRET=your-super-strong-refresh-secret-here

# Domain Configuration
CORS_ORIGIN=https://rtexpress.co.tz
API_BASE_URL=https://api.rtexpress.co.tz
FRONTEND_ORIGIN=https://rtexpress.co.tz

# Email (use your hosting provider's SMTP)
SMTP_HOST=mail.rtexpress.co.tz
SMTP_USER=noreply@rtexpress.co.tz
SMTP_PASS=your-email-password
SMTP_FROM=noreply@rtexpress.co.tz
```

---

## 🌐 Two API Access Options

### Option A: Subdomain (Recommended)
- **API URL**: `https://api.rtexpress.co.tz`
- **Setup**: Create subdomain in cPanel
- **Benefits**: Clean, professional, no proxy needed

### Option B: Proxy via Main Domain
- **API URL**: `https://rtexpress.co.tz/api`
- **Setup**: Use included proxy .htaccess
- **Benefits**: Single domain, simpler DNS

---

## 🧪 Testing Your Deployment

### Test API Health
```bash
# If using subdomain
curl https://api.rtexpress.co.tz/health

# If using proxy
curl https://rtexpress.co.tz/api/health

# Expected response:
{"status":"ok","timestamp":"2025-09-20T...","uptime":...}
```

### Test Frontend
- Visit: `https://rtexpress.co.tz`
- Should load React app
- Check browser console for errors

### Test Full System
1. **Register new customer** at `https://rtexpress.co.tz/register`
2. **Login** at `https://rtexpress.co.tz/login`
3. **Access admin** at `https://rtexpress.co.tz/admin`
4. **Check notifications** (bell icon should work)

---

## 🔍 Troubleshooting

### If API doesn't start:
```bash
# Check logs
cd /home/rtexpres/rtexpress-api
tail -f logs/app.log

# Or check in cPanel Node.js interface
```

### If database connection fails:
```bash
# Test database connection
cd /home/rtexpres/rtexpress-api
npx prisma db pull
```

### If CORS errors occur:
- Update `CORS_ORIGIN` in `.env`
- Restart Node.js app
- Check browser network tab

---

## 📊 What You Get

### ✅ Complete Features
- **User Management**: Admin, Manager, Staff, Customer roles
- **Shipping System**: Tracking, status updates, invoicing
- **Notification System**: Real-time notifications with WebSocket
- **Support System**: Tickets, knowledge base, SLA monitoring
- **Mobile-First Design**: Responsive on all devices
- **Security**: JWT auth, CORS, rate limiting, input validation

### ✅ Production Ready
- Optimized builds
- Error handling
- Logging
- Performance optimizations
- Security headers

---

## 🎉 Success!

Once deployed, you'll have:
- **Frontend**: `https://rtexpress.co.tz`
- **API**: `https://api.rtexpress.co.tz` (or `/api`)
- **Admin Portal**: `https://rtexpress.co.tz/admin`
- **Customer Portal**: `https://rtexpress.co.tz/customer`

Your RT Express shipping management system will be fully operational with the comprehensive notification system we just implemented! 🚀

---

**This approach eliminates all the permission issues you encountered and follows industry best practices for production deployments.**
