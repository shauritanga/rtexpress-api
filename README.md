# RT Express Backend (Express + MySQL + Prisma)

Secure REST API for the RT Express frontend.

## Stack

- Node.js + Express (TypeScript)
- Prisma ORM (MySQL)
- JWT Auth: Access (Bearer) + Refresh (httpOnly cookie)
- RBAC middleware (ADMIN/STAFF/CUSTOMER)
- Zod validation, helmet, cors, rate limit, morgan
- bcryptjs password hashing

## Setup

1. Copy env

```
cp .env.example .env
```

2. Fill DATABASE_URL, JWT secrets, CORS_ORIGIN
3. Install deps

```
npm install
```

4. Generate client and migrate

```
npm run prisma:generate
npm run prisma:migrate -- -n init
```

5. Start dev

```
npm run dev
```

## Endpoints (initial)

- GET /health
- POST /auth/login
- POST /auth/refresh
- POST /auth/logout
- GET /customers (admin/staff)
- GET /customers/:id (owner/admin/staff)
- POST /customers (admin/staff)
- GET /shipments (customer sees own, staff/admin all)
- POST /shipments
- GET /invoices (customer sees own)
- POST /invoices/:id/payments
- POST /payments/clickpesa/init (placeholder)
- POST /payments/clickpesa/webhook (placeholder)

## Notes

- All monetary fields default to TZS.
- Implement Google OAuth for customer in /auth/google/\* when ready.
- Move ClickPesa initiation to backend (placeholder provided).
