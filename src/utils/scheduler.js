require('dotenv').config();
const { Resend } = require('resend');
// FIX: use shared db pool instead of creating a second one
const db = require('../db');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM        = process.env.EMAIL_FROM  || 'onboarding@resend.dev';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function fmt(iso, style) {
  return new Date(iso).toLocaleString('en-GB', style);
}
const fmtDate = iso => fmt(iso, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
const fmtTime = iso => fmt(iso, { hour:'2-digit', minute:'2-digit' });

// FIX: consistent RSD formatting
function formatPrice(val) {
  return `${Number(val).toFixed(0)} RSD`;
}

async function sendReminder({ client, services, totalDuration, booking }) {
  if (!client.email) return;

  // FIX: show all services in reminder email
  const serviceLabel = services.map(s => s.name).join(' + ');
  const serviceRows  = services.map(s =>
    `<tr><td style="color:#993556;padding:6px 0">${s.name}</td><td style="color:#72243E;font-weight:500;text-align:right">${s.duration_mins} min</td></tr>`
  ).join('');

  await resend.emails.send({
    from: FROM,
    to: client.email,
    subject: `Reminder — your Snails appointment tomorrow at ${fmtTime(booking.booked_at)}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3d3d3a">
        <div style="background:#fff0f5;padding:24px;border-radius:12px;text-align:center;margin-bottom:24px">
          <h1 style="font-size:24px;font-weight:400;color:#72243E;margin:0">Snails ✦</h1>
        </div>
        <h2 style="font-size:18px;font-weight:500;color:#72243E;margin-bottom:6px">See you tomorrow, ${client.name.split(' ')[0]}!</h2>
        <div style="background:#fff0f5;border:1px solid #ffd6e7;border-radius:10px;padding:18px;margin-bottom:20px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${serviceRows}
            <tr><td colspan="2" style="border-top:1px solid #ffd6e7;padding-top:8px"></td></tr>
            <tr><td style="color:#993556;padding:6px 0">Total duration</td><td style="color:#72243E;font-weight:500;text-align:right">${totalDuration} min</td></tr>
            <tr><td style="color:#993556;padding:6px 0">Date</td><td style="color:#72243E;font-weight:500;text-align:right">${fmtDate(booking.booked_at)}</td></tr>
            <tr><td style="color:#993556;padding:6px 0">Time</td><td style="color:#72243E;font-weight:500;text-align:right">${fmtTime(booking.booked_at)}</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#993556">Need to cancel? Please let us know at least 24 hours in advance.</p>
        <p style="color:#d4537e;font-size:12px;margin-top:28px">Snails nail studio ✦</p>
      </div>
    `,
  });
  console.log(`  ✓ Reminder sent → ${client.email}`);
}

async function markReminded(bookingId) {
  await db.query('UPDATE bookings SET reminder_sent = TRUE WHERE id = $1', [bookingId]);
}

async function sendAdminDailySummary(bookings) {
  if (!ADMIN_EMAIL || bookings.length === 0) return;

  // FIX: use total_price and service labels (already resolved in runReminders)
  const rows = bookings.map(b => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #fff0f5;color:#72243E">${fmtTime(b.booked_at)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fff0f5;color:#72243E;font-weight:500">${b.client_name}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fff0f5;color:#993556">${b.service_label}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fff0f5;color:#d4537e">${formatPrice(b.total_price)}</td>
    </tr>
  `).join('');

  // FIX: use total_price for sum, RSD not £
  const total = bookings.reduce((s, b) => s + Number(b.total_price), 0);

  await resend.emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `Snails — ${bookings.length} appointment${bookings.length !== 1 ? 's' : ''} tomorrow`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#3d3d3a">
        <div style="background:#fff0f5;padding:20px;border-radius:12px;margin-bottom:20px">
          <h1 style="font-size:20px;font-weight:400;color:#72243E;margin:0">Snails ✦</h1>
        </div>
        <h2 style="font-size:17px;font-weight:500;color:#72243E;margin-bottom:4px">Tomorrow's schedule</h2>
        <p style="color:#993556;font-size:14px;margin-bottom:16px">${bookings.length} appointment${bookings.length !== 1 ? 's' : ''} · ${formatPrice(total)} total</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #ffd6e7;border-radius:10px;overflow:hidden">
          <thead><tr style="background:#ffd6e7">
            <th style="padding:8px 10px;text-align:left;color:#72243E">Time</th>
            <th style="padding:8px 10px;text-align:left;color:#72243E">Client</th>
            <th style="padding:8px 10px;text-align:left;color:#72243E">Service</th>
            <th style="padding:8px 10px;text-align:left;color:#72243E">Price</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `,
  });
  console.log(`  ✓ Daily summary sent → ${ADMIN_EMAIL}`);
}

async function runReminders() {
  const now = new Date();
  console.log(`\n[${now.toISOString()}] Running reminder job…`);
  const windowStart = new Date(now.getTime() + 20 * 3600 * 1000);
  const windowEnd   = new Date(now.getTime() + 28 * 3600 * 1000);

  try {
    // FIX: use LEFT JOIN, fetch total_price and total_duration_mins
    const result = await db.query(
      `SELECT b.id, b.booked_at, b.total_duration_mins, b.total_price,
         c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
         s.name AS service_name, s.duration_mins, s.price
       FROM bookings b
       JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.status = 'confirmed'
         AND b.reminder_sent = FALSE
         AND b.booked_at >= $1
         AND b.booked_at <  $2
       ORDER BY b.booked_at ASC`,
      [windowStart.toISOString(), windowEnd.toISOString()]
    );

    // For each booking, resolve all services from booking_services
    const bookings = await Promise.all(result.rows.map(async (b) => {
      const svcResult = await db.query(
        `SELECT s.name, s.duration_mins, s.price
         FROM booking_services bs
         JOIN services s ON s.id = bs.service_id
         WHERE bs.booking_id = $1
         ORDER BY bs.sort_order`,
        [b.id]
      );
      const services = svcResult.rows.length > 0
        ? svcResult.rows
        : [{ name: b.service_name, duration_mins: b.duration_mins, price: b.price }];

      return {
        ...b,
        services,
        service_label: services.map(s => s.name).join(' + '),
        total_duration_mins: b.total_duration_mins ?? services.reduce((s, x) => s + x.duration_mins, 0),
        total_price: b.total_price ?? services.reduce((s, x) => s + Number(x.price), 0),
      };
    }));

    console.log(`  Found ${bookings.length} booking(s) needing reminders`);

    for (const b of bookings) {
      try {
        await sendReminder({
          client:        { name: b.client_name, email: b.client_email, phone: b.client_phone },
          services:      b.services,
          totalDuration: b.total_duration_mins,
          booking:       { id: b.id, booked_at: b.booked_at },
        });
        await markReminded(b.id);
      } catch (err) {
        console.error(`  ✗ Failed for booking ${b.id}:`, err.message);
      }
    }

    try { await sendAdminDailySummary(bookings); } catch (err) { console.error('  ✗ Admin summary failed:', err.message); }
    console.log(`  Done.\n`);
  } catch (err) {
    console.error('  Job error:', err.message);
  }
}

if (require.main === module) {
  runReminders().then(() => process.exit(0));
} else {
  module.exports = { runReminders };
}
