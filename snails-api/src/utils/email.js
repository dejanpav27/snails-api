const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM || 'bookings@snails.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function formatDate(isoString) {
  return new Date(isoString).toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function sendBookingConfirmation({ client, service, booking }) {
  const dateStr = formatDate(booking.booked_at);

  // Email to the client
  if (client.email) {
    await resend.emails.send({
      from: FROM,
      to: client.email,
      subject: `Your Snails booking is confirmed — ${service.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3d3d3a">
          <div style="background:#fff0f5;padding:24px;border-radius:12px;margin-bottom:20px;text-align:center">
            <h1 style="color:#72243E;font-size:22px;margin:0">Snails ✦</h1>
            <p style="color:#d4537e;margin:4px 0 0;font-size:13px">nail studio</p>
          </div>
          <h2 style="color:#72243E;font-size:18px">You're all booked, ${client.name}!</h2>
          <p style="color:#993556">Here are your appointment details:</p>
          <div style="background:#fff0f5;border:1px solid #ffd6e7;border-radius:10px;padding:16px;margin:16px 0">
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="color:#993556;padding:6px 0">Service</td><td style="color:#72243E;font-weight:500;text-align:right">${service.name}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Date &amp; time</td><td style="color:#72243E;font-weight:500;text-align:right">${dateStr}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Duration</td><td style="color:#72243E;font-weight:500;text-align:right">${service.duration_mins} min</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Price</td><td style="color:#d4537e;font-weight:500;text-align:right">£${Number(service.price).toFixed(2)}</td></tr>
            </table>
          </div>
          <p style="color:#993556;font-size:13px">Need to cancel or reschedule? Just reply to this email.</p>
          <p style="color:#d4537e;font-size:12px;margin-top:24px">Snails nail studio — see you soon ✦</p>
        </div>
      `,
    });
  }

  // Notification to the admin
  if (ADMIN_EMAIL) {
    await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject: `New booking — ${client.name} — ${service.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3d3d3a">
          <h2 style="color:#72243E">New booking received</h2>
          <div style="background:#fff0f5;border:1px solid #ffd6e7;border-radius:10px;padding:16px">
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="color:#993556;padding:6px 0">Client</td><td style="color:#72243E;font-weight:500;text-align:right">${client.name}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Phone</td><td style="color:#72243E;text-align:right">${client.phone || '—'}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Email</td><td style="color:#72243E;text-align:right">${client.email || '—'}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Service</td><td style="color:#72243E;font-weight:500;text-align:right">${service.name}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Date &amp; time</td><td style="color:#72243E;font-weight:500;text-align:right">${dateStr}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Notes</td><td style="color:#72243E;text-align:right">${booking.client_notes || '—'}</td></tr>
            </table>
          </div>
        </div>
      `,
    });
  }
}

async function sendCancellationEmail({ client, service, booking }) {
  if (!client.email) return;
  const dateStr = formatDate(booking.booked_at);

  await resend.emails.send({
    from: FROM,
    to: client.email,
    subject: `Your Snails booking has been cancelled`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3d3d3a">
        <div style="background:#fff0f5;padding:24px;border-radius:12px;margin-bottom:20px;text-align:center">
          <h1 style="color:#72243E;font-size:22px;margin:0">Snails ✦</h1>
        </div>
        <h2 style="color:#72243E">Booking cancelled</h2>
        <p style="color:#993556">Your appointment for <strong>${service.name}</strong> on ${dateStr} has been cancelled.</p>
        <p style="color:#993556;font-size:13px">Want to rebook? Visit our booking page or reply to this email.</p>
        <p style="color:#d4537e;font-size:12px;margin-top:24px">Snails nail studio ✦</p>
      </div>
    `,
  });
}

module.exports = { sendBookingConfirmation, sendCancellationEmail };
