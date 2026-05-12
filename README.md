# Snails — Phase 4: Email Reminders

Adds automatic 24-hour reminders for every confirmed booking, plus a daily summary email to the admin.

---

## What this phase adds

- **Client reminder** — sent ~24h before each appointment to the client's email
- **Admin daily summary** — sent at the same time, listing tomorrow's full schedule with times, names, services and total revenue
- **Scheduler** — runs inside the API every hour, so no extra services needed
- **Manual trigger** — a protected endpoint to fire reminders on demand for testing

---

## How to integrate into Phase 1

This phase adds 2 new files and updates 1 existing file in your `snails-api` folder.

### Step 1 — Copy the new files

Copy these two files into your `snails-api/src/` folder:

```
snails-phase4/src/scheduler.js  →  snails-api/src/scheduler.js
snails-phase4/src/migrate.js    →  snails-api/src/migrate.js
```

### Step 2 — Replace server.js

Replace your existing `snails-api/src/server.js` with the one from this folder:

```
snails-phase4/src/server.js  →  snails-api/src/server.js  (REPLACE)
```

### Step 3 — Run the database migration

This adds a `reminder_sent` column to the bookings table:

```bash
cd snails-api
node src/migrate.js
```

You should see:
```
✓ reminder_sent column added to bookings
✓ Index created
Migration complete!
```

### Step 4 — Restart the API

```bash
npm run dev
```

You'll now see in the console:
```
Reminder scheduler started — runs every hour
[timestamp] Running reminder job…
  Found 0 booking(s) needing reminders
  Done.
```

---

## How it works

Every hour the scheduler:

1. Looks for bookings that are:
   - Status = `confirmed`
   - `reminder_sent` = false
   - Starting between 20 and 28 hours from now (the "tomorrow window")

2. For each booking, sends the client a reminder email (if they have an email on file)

3. Marks the booking as `reminder_sent = true` so it never double-sends

4. Sends the admin a daily summary of all tomorrow's appointments

---

## Testing reminders manually

Without waiting 24 hours, you can trigger the job manually:

```bash
# Fire the reminder job right now
node src/scheduler.js
```

Or via the API endpoint (uses your JWT_SECRET as a simple token):

```bash
curl -H "Authorization: Bearer YOUR_JWT_SECRET" \
  http://localhost:3001/admin/send-reminders
```

To test a real reminder email, create a booking with:
- Status = `confirmed`
- `booked_at` = tomorrow's date at any time
- Client has an email address

Then run `node src/scheduler.js` — you'll see the email sent in the console output.

---

## .env — no new variables needed

Phase 4 uses the same variables already in your `.env`:

```
RESEND_API_KEY    — already set in Phase 1
EMAIL_FROM        — already set in Phase 1
ADMIN_EMAIL       — already set in Phase 1
DATABASE_URL      — already set in Phase 1
```

---

## On Railway (production)

The scheduler runs automatically inside the API process — no separate cron job needed. Railway keeps your API running 24/7, so the `setInterval` fires every hour as long as the server is up.

---

## Next: Phase 5

Phase 5 is deployment — putting everything live with real URLs so your girlfriend can start using it with real clients.
