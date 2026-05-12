# Snails API — Phase 1

Backend for the Snails nail studio booking app. Built with Node.js, Express, and PostgreSQL.

---

## Project structure

```
snails-api/
├── src/
│   ├── server.js              ← entry point, Express app setup
│   ├── db/
│   │   ├── index.js           ← PostgreSQL connection pool
│   │   ├── setup.js           ← creates tables + seeds services
│   │   └── createAdmin.js     ← creates the admin account
│   ├── middleware/
│   │   └── auth.js            ← JWT verification middleware
│   ├── routes/
│   │   ├── auth.js            ← POST /auth/login, GET /auth/me
│   │   ├── services.js        ← GET/POST/PATCH /services
│   │   ├── availability.js    ← GET /availability
│   │   ├── bookings.js        ← GET/POST/PATCH /bookings
│   │   └── clients.js         ← GET/POST/PATCH /clients
│   └── utils/
│       └── email.js           ← Resend email helpers
├── .env.example
├── .gitignore
└── package.json
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your .env file

```bash
cp .env.example .env
```

Then open `.env` and fill in:
- `DATABASE_URL` — your PostgreSQL connection string
- `JWT_SECRET` — a long random string (run `openssl rand -base64 48`)
- `RESEND_API_KEY` — get a free key at [resend.com](https://resend.com)
- `EMAIL_FROM` — the email you send from (must be verified in Resend)
- `ADMIN_EMAIL` — where new booking alerts go
- `FRONTEND_URL` — your React app URL (for CORS)

### 3. Set up the database

Make sure PostgreSQL is running, then:

```bash
npm run db:setup
```

This creates all the tables and seeds starter services.

### 4. Create your admin account

Open `src/db/createAdmin.js` and edit the name, email and password at the top, then run:

```bash
node src/db/createAdmin.js
```

### 5. Start the server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

The API will be running at `http://localhost:3001`.

---

## API endpoints

### Public (no auth needed)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/auth/login` | Admin login — returns JWT token |
| GET | `/services` | List all active services |
| GET | `/availability?date=YYYY-MM-DD&service_id=uuid` | Free time slots |
| POST | `/bookings` | Create a booking (client-facing) |

### Admin only (send `Authorization: Bearer <token>` header)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/me` | Verify token, get admin info |
| GET | `/bookings` | List all bookings (filter by `?date=` or `?status=`) |
| GET | `/bookings/:id` | Get a single booking |
| PATCH | `/bookings/:id/status` | Set status: pending / confirmed / cancelled |
| POST | `/bookings/admin` | Create booking manually (skips availability check) |
| GET | `/clients` | List clients (search with `?search=`) |
| GET | `/clients/:id` | Client detail + booking history |
| POST | `/clients` | Add a client manually |
| PATCH | `/clients/:id` | Update client details |
| GET | `/services/all` | All services including inactive |
| POST | `/services` | Add a new service |
| PATCH | `/services/:id` | Update a service |
| DELETE | `/services/:id` | Deactivate a service |

---

## Example: create a booking (client flow)

```bash
# 1. Get services
curl http://localhost:3001/services

# 2. Check availability
curl "http://localhost:3001/availability?date=2025-06-01&service_id=<uuid>"

# 3. Book a slot
curl -X POST http://localhost:3001/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "<uuid>",
    "booked_at": "2025-06-01T10:00:00.000Z",
    "client_notes": "Love pastel designs!",
    "client": {
      "name": "Sofia M.",
      "phone": "+44 7700 900123",
      "email": "sofia@example.com"
    }
  }'
```

## Example: admin login + confirm a booking

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@snails.com","password":"your-password"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Confirm a booking
curl -X PATCH http://localhost:3001/bookings/<booking-id>/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}'
```

---

## Deploying to Railway

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add a PostgreSQL plugin to the project
4. Set all the environment variables from `.env.example` in Railway's dashboard
5. Railway auto-detects Node.js and runs `npm start`
6. Run the setup script once via Railway's shell: `npm run db:setup`
7. Then create your admin: `node src/db/createAdmin.js`

---

## Next: Phase 2

With this API running, the next step is building the React admin dashboard that connects to it. See the build plan for details.
