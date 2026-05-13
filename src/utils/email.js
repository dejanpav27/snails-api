const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM        = process.env.EMAIL_FROM  || 'onboarding@resend.dev';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function formatDate(isoString) {
  return new Date(isoString).toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatPrice(val) {
  return `${Number(val).toFixed(0)} RSD`;
}

// Accepts either single service or array of services
function normalizeServices(services, service) {
  if (services && Array.isArray(services)) return services;
  if (service) return [service];
  return [];
}

async function sendBookingConfirmation({ client, services, service, totalDuration, totalPrice, booking }) {
  const allServices   = normalizeServices(services, service);
  const totalDur      = totalDuration || allServices.reduce((s, x) => s + x.duration_mins, 0);
  const totalPriceVal = totalPrice    || allServices.reduce((s, x) => s + Number(x.price), 0);
  const dateStr       = formatDate(booking.booked_at);

  const serviceRows = allServices.map(s => `
    <tr>
      <td style="color:#993556;padding:6px 0">${s.name}</td>
      <td style="color:#72243E;font-weight:500;text-align:right">${s.duration_mins} min · ${formatPrice(s.price)}</td>
    </tr>
  `).join('');

  if (client.email) {
    await resend.emails.send({
      from: FROM,
      to: client.email,
      subject: `Your Snails booking is confirmed`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3d3d3a">
          <div style="background:#fff0f5;padding:24px;border-radius:12px;margin-bottom:20px;text-align:center">
            <h1 style="color:#72243E;font-size:22px;margin:0">Snails ✦</h1>
            <p style="color:#d4537e;margin:4px 0 0;font-size:13px">nails by Sara Pudar</p>
          </div>
          <h2 style="color:#72243E;font-size:18px">You're all booked, ${client.name}!</h2>
          <div style="background:#fff0f5;border:1px solid #ffd6e7;border-radius:10px;padding:16px;margin:16px 0">
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              ${serviceRows}
              <tr><td colspan="2" style="border-top:1px solid #ffd6e7;padding-top:8px"></td></tr>
              <tr>
                <td style="color:#72243E;font-weight:500;padding:6px 0">Total</td>
                <td style="color:#d4537e;font-weight:500;text-align:right">${totalDur} min · ${formatPrice(totalPriceVal)}</td>
              </tr>
              <tr>
                <td style="color:#993556;padding:6px 0">Date &amp; time</td>
                <td style="color:#72243E;font-weight:500;text-align:right">${dateStr}</td>
              </tr>
            </table>
          </div>
          <p style="color:#993556;font-size:13px">Need to cancel or reschedule? Please give at least 24 hours notice.</p>
          <p style="color:#d4537e;font-size:12px;margin-top:24px">Snails nail studio — see you soon ✦</p>
        </div>
      `,
    });
  }

  if (ADMIN_EMAIL) {
    await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject: `New booking — ${client.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3d3d3a">
          <h2 style="color:#72243E">New booking received</h2>
          <div style="background:#fff0f5;border:1px solid #ffd6e7;border-radius:10px;padding:16px">
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="color:#993556;padding:6px 0">Client</td><td style="color:#72243E;font-weight:500;text-align:right">${client.name}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Phone</td><td style="color:#72243E;text-align:right">${client.phone || '—'}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Email</td><td style="color:#72243E;text-align:right">${client.email || '—'}</td></tr>
              <tr><td colspan="2" style="border-top:1px solid #ffd6e7;padding-top:8px"></td></tr>
              ${serviceRows}
              <tr><td colspan="2" style="border-top:1px solid #ffd6e7;padding-top:8px"></td></tr>
              <tr><td style="color:#72243E;font-weight:500;padding:6px 0">Total</td><td style="color:#d4537e;font-weight:500;text-align:right">${totalDur} min · ${formatPrice(totalPriceVal)}</td></tr>
              <tr><td style="color:#993556;padding:6px 0">Date &amp; time</td><td style="color:#72243E;font-weight:500;text-align:right">${dateStr}</td></tr>
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
        <p style="color:#993556;font-size:13px;margin-top:12px">Want to rebook? Visit our booking page.</p>
        <p style="color:#d4537e;font-size:12px;margin-top:24px">Snails nail studio ✦</p>
      </div>
    `,
  });
}

module.exports = { sendBookingConfirmation, sendCancellationEmail };
