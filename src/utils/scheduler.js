require('dotenv').config();
const { Resend } = require('resend');
const db = require('../db');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM        = process.env.EMAIL_FROM  || 'onboarding@resend.dev';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function formatDate(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
function formatTime(iso) {
  return new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function formatPrice(val) {
  return `${Number(val).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} RSD`;
}

function baseWrapper(content) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;color:#3d3d3a;background:#fff;padding:0">
      <div style="background:#fff0f5;padding:28px;text-align:center;border-radius:12px 12px 0 0">
        <img src="https://snails-booking.vercel.app/logo.png" alt="Snails Nail Studio" style="width:160px;height:auto;display:block;margin:0 auto" />
      </div>
      <div style="padding:32px 36px">
        ${content}
      </div>
      <div style="padding:20px 36px;border-top:1px solid #ffd6e7;text-align:center">
        <p style="font-size:12px;color:#d4537e;margin:0">Snails Nail Studio ✦</p>
      </div>
    </div>
  `;
}

function appointmentBox(rows) {
  return `
    <div style="background:#fff0f5;border:1px solid #ffd6e7;border-radius:10px;padding:18px 20px;margin:20px 0">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows}
      </table>
    </div>
  `;
}

function row(label, value) {
  return `
    <tr>
      <td style="color:#993556;padding:5px 0;vertical-align:top">${label}</td>
      <td style="color:#72243E;font-weight:500;text-align:right;padding:5px 0">${value}</td>
    </tr>
  `;
}
function divider() {
  return `<tr><td colspan="2" style="border-top:1px solid #ffd6e7;padding:4px 0"></td></tr>`;
}

async function sendReminder({ client, services, totalDuration, booking }) {
  if (!client.email) return;

  const serviceLabel = services.map(s => s.name).join(' + ');
  const dateStr      = formatDate(booking.booked_at);
  const timeStr      = formatTime(booking.booked_at);

  const detailRows = row('Service', serviceLabel)
    + row('Date', dateStr)
    + row('Time', timeStr)
    + row('Duration', `${totalDuration} min`);

  await resend.emails.send({
    from: FROM,
    to: client.email,
    subject: 'See you tomorrow ✦',
    html: baseWrapper(`
      <p style="font-size:16px;color:#3d3d3a;margin:0 0 8px">Hi ${client.name.split(' ')[0]},</p>
      <p style="font-size:14px;color:#993556;margin:0 0 20px">Just a friendly reminder that your appointment is tomorrow.</p>
      ${appointmentBox(detailRows)}
      <p style="font-size:14px;color:#993556;margin:0 0 8px">We're looking forward to seeing you and helping you enjoy a little well-deserved self-care.</p>
      <p style="font-size:13px;color:#993556;margin:0 0 20px">If your plans have changed, please contact us at least 24 hours before your appointment.</p>
      <p style="font-size:14px;color:#72243E;margin:0 0 4px">See you soon ✦</p>
      <p style="font-size:13px;color:#993556;margin:0">Warmly,<br>Snails Nail Studio</p>
    `),
  });
  console.log(`  ✓ Reminder sent → ${client.email}`);
}

async function markReminded(bookingId) {
  await db.query('UPDATE bookings SET reminder_sent = TRUE WHERE id = $1', [bookingId]);
}

async function sendAdminDailySummary(bookings) {
  if (!ADMIN_EMAIL || bookings.length === 0) return;

  const total      = bookings.reduce((s, b) => s + Number(b.total_price), 0);
  const newClients = bookings.filter(b => b.is_new_client).length;

  const tableRows = bookings.map(b => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #fff0f5;color:#72243E">${formatTime(b.booked_at)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #fff0f5;color:#72243E;font-weight:500">${b.client_name}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #fff0f5;color:#993556">${b.service_label}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #fff0f5;color:#d4537e;text-align:right">${formatPrice(b.total_price)}</td>
    </tr>
  `).join('');

  await resend.emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `Tomorrow's Schedule`,
    html: baseWrapper(`
      <p style="font-size:16px;color:#3d3d3a;margin:0 0 20px">Good morning,</p>
      <p style="font-size:14px;color:#993556;margin:0 0 20px">Here's an overview of tomorrow's bookings.</p>
      <div style="background:#fff0f5;border:1px solid #ffd6e7;border-radius:10px;padding:16px 20px;margin:0 0 20px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${row('Appointments', bookings.length)}
          ${row('Expected revenue', formatPrice(total))}
          ${newClients > 0 ? row('New clients', newClients) : ''}
        </table>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #ffd6e7;border-radius:10px;overflow:hidden">
        <thead>
          <tr style="background:#ffd6e7">
            <th style="padding:9px 12px;text-align:left;color:#72243E;font-weight:500">Time</th>
            <th style="padding:9px 12px;text-align:left;color:#72243E;font-weight:500">Client</th>
            <th style="padding:9px 12px;text-align:left;color:#72243E;font-weight:500">Service</th>
            <th style="padding:9px 12px;text-align:right;color:#72243E;font-weight:500">Price</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p style="font-size:14px;color:#72243E;margin:24px 0 0">Have a wonderful and successful day ✦</p>
    `),
  });
  console.log(`  ✓ Daily summary sent → ${ADMIN_EMAIL}`);
}

async function runReminders() {
  const now = new Date();
  console.log(`\n[${now.toISOString()}] Running reminder job…`);
  const windowStart = new Date(now.getTime() + 20 * 3600 * 1000);
  const windowEnd   = new Date(now.getTime() + 28 * 3600 * 1000);

  try {
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

      const countResult = await db.query(
        `SELECT COUNT(*) FROM bookings WHERE client_id = (SELECT client_id FROM bookings WHERE id = $1)`,
        [b.id]
      );
      const is_new_client = parseInt(countResult.rows[0].count) === 1;

      return {
        ...b,
        services,
        service_label: services.map(s => s.name).join(' + '),
        total_duration_mins: b.total_duration_mins ?? services.reduce((s, x) => s + x.duration_mins, 0),
        total_price: b.total_price ?? services.reduce((s, x) => s + Number(x.price), 0),
        is_new_client,
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
