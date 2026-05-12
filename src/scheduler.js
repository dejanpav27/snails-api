require('dotenv').config();
const { Resend } = require('resend');
const { Pool }   = require('pg');

const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM        = process.env.EMAIL_FROM  || 'bookings@snails.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function fmt(iso, style) {
  return new Date(iso).toLocaleString('en-GB', style);
}
const fmtDate = iso => fmt(iso, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
const fmtTime = iso => fmt(iso, { hour:'2-digit', minute:'2-digit' });

/* ── Send one reminder ───────────────────────────────────── */
async function sendReminder({ client, service, booking }) {
  if (!client.email) return;                    // no email = skip silently

  await resend.emails.send({
    from:    FROM,
    to:      client.email,
    subject: `Reminder — your Snails appointment tomorrow at ${fmtTime(booking.booked_at)}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3d3d3a">
        <div style="background:#fff0f5;padding:24px;border-radius:12px;text-align:center;margin-bottom:24px">
          <h1 style="font-size:24px;font-weight:400;color:#72243E;margin:0;font-family:Georgia,serif">Snails</h1>
          <p style="color:#d4537e;margin:4px 0 0;font-size:13px">nail studio</p>
        </div>

        <h2 style="font-size:18px;font-weight:500;color:#72243E;margin-bottom:6px">
          See you tomorrow, ${client.name.split(' ')[0]}! ✦
        </h2>
        <p style="color:#993556;margin-bottom:20px">Just a little reminder about your appointment:</p>

        <div style="background:#fff0f5;border:1px solid #ffd6e7;border-radius:10px;padding:18px;margin-bottom:20px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr>
              <td style="color:#993556;padding:6px 0">Service</td>
              <td style="color:#72243E;font-weight:500;text-align:right">${service.name}</td>
            </tr>
            <tr>
              <td style="color:#993556;padding:6px 0">Date</td>
              <td style="color:#72243E;font-weight:500;text-align:right">${fmtDate(booking.booked_at)}</td>
            </tr>
            <tr>
              <td style="color:#993556;padding:6px 0">Time</td>
              <td style="color:#72243E;font-weight:500;text-align:right">${fmtTime(booking.booked_at)}</td>
            </tr>
            <tr>
              <td style="color:#993556;padding:6px 0">Duration</td>
              <td style="color:#72243E;font-weight:500;text-align:right">${service.duration_mins} min</td>
            </tr>
          </table>
        </div>

        <p style="font-size:13px;color:#993556;line-height:1.6">
          Need to cancel or reschedule? Please let us know as soon as possible —
          we ask for at least 24 hours notice. Just reply to this email or send a message.
        </p>

        <p style="color:#d4537e;font-size:12px;margin-top:28px">
          Snails nail studio — see you tomorrow ✦
        </p>
      </div>
    `,
  });

  console.log(`  ✓ Reminder sent → ${client.email} (booking ${booking.id})`);
}

/* ── Mark a booking as reminded ────────────────────────────── */
async function markReminded(bookingId) {
  await pool.query(
    'UPDATE bookings SET reminder_sent = TRUE WHERE id = $1',
    [bookingId]
  );
}

/* ── Send daily summary to admin ─────────────────────────── */
async function sendAdminDailySummary(bookings) {
  if (!ADMIN_EMAIL || bookings.length === 0) return;

  const rows = bookings.map(b => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #fff0f5;color:#72243E">${fmtTime(b.booked_at)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fff0f5;color:#72243E;font-weight:500">${b.client_name}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fff0f5;color:#993556">${b.service_name}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fff0f5;color:#d4537e">£${Number(b.price).toFixed(2)}</td>
    </tr>
  `).join('');

  const total = bookings.reduce((s, b) => s + Number(b.price), 0);
  const tomorrow = fmtDate(new Date(Date.now() + 86400000).toISOString());

  await resend.emails.send({
    from:    FROM,
    to:      ADMIN_EMAIL,
    subject: `Snails — ${bookings.length} appointment${bookings.length !== 1 ? 's' : ''} tomorrow`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#3d3d3a">
        <div style="background:#fff0f5;padding:20px;border-radius:12px;margin-bottom:20px">
          <h1 style="font-size:20px;font-weight:400;color:#72243E;font-family:Georgia,serif;margin:0">Snails</h1>
        </div>
        <h2 style="font-size:17px;font-weight:500;color:#72243E;margin-bottom:4px">
          Tomorrow's schedule — ${tomorrow}
        </h2>
        <p style="color:#993556;font-size:14px;margin-bottom:16px">
          ${bookings.length} appointment${bookings.length !== 1 ? 's' : ''} · £${total.toFixed(2)} total
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #ffd6e7;border-radius:10px;overflow:hidden">
          <thead>
            <tr style="background:#ffd6e7">
              <th style="padding:8px 10px;text-align:left;color:#72243E;font-weight:500">Time</th>
              <th style="padding:8px 10px;text-align:left;color:#72243E;font-weight:500">Client</th>
              <th style="padding:8px 10px;text-align:left;color:#72243E;font-weight:500">Service</th>
              <th style="padding:8px 10px;text-align:left;color:#72243E;font-weight:500">Price</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="font-size:12px;color:#d4537e;margin-top:24px">Snails nail studio ✦</p>
      </div>
    `,
  });

  console.log(`  ✓ Daily summary sent → ${ADMIN_EMAIL}`);
}

/* ── Main job ────────────────────────────────────────────── */
async function runReminders() {
  const now  = new Date();
  console.log(`\n[${now.toISOString()}] Running reminder job…`);

  // Window: bookings starting between 20h and 28h from now
  // (catches "tomorrow" regardless of what time the job runs)
  const windowStart = new Date(now.getTime() + 20 * 3600 * 1000);
  const windowEnd   = new Date(now.getTime() + 28 * 3600 * 1000);

  try {
    const result = await pool.query(
      `SELECT
         b.id, b.booked_at, b.client_notes,
         c.id   AS client_id,
         c.name AS client_name,
         c.email AS client_email,
         c.phone AS client_phone,
         s.name  AS service_name,
         s.duration_mins,
         s.price
       FROM bookings b
       JOIN clients  c ON c.id = b.client_id
       JOIN services s ON s.id = b.service_id
       WHERE b.status = 'confirmed'
         AND b.reminder_sent = FALSE
         AND b.booked_at >= $1
         AND b.booked_at <  $2
       ORDER BY b.booked_at ASC`,
      [windowStart.toISOString(), windowEnd.toISOString()]
    );

    const bookings = result.rows;
    console.log(`  Found ${bookings.length} booking(s) needing reminders`);

    // Send individual reminders
    for (const b of bookings) {
      try {
        await sendReminder({
          client:  { id: b.client_id, name: b.client_name, email: b.client_email, phone: b.client_phone },
          service: { name: b.service_name, duration_mins: b.duration_mins, price: b.price },
          booking: { id: b.id, booked_at: b.booked_at },
        });
        await markReminded(b.id);
      } catch (err) {
        console.error(`  ✗ Failed reminder for booking ${b.id}:`, err.message);
      }
    }

    // Send daily summary to admin (once per run if there are bookings)
    try {
      await sendAdminDailySummary(bookings);
    } catch (err) {
      console.error('  ✗ Admin summary failed:', err.message);
    }

    console.log(`  Done.\n`);
  } catch (err) {
    console.error('  Job error:', err.message);
  }
}

/* ── Entry point ─────────────────────────────────────────── */
// If called directly (node scheduler.js) run once immediately
if (require.main === module) {
  runReminders().then(() => process.exit(0));
} else {
  // When required by the server, export the function
  module.exports = { runReminders };
}
