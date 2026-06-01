const { Resend } = require('resend');
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

function normalizeServices(services, service) {
  if (services && Array.isArray(services)) return services;
  if (service) return [service];
  return [];
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

async function sendBookingConfirmation({ client, services, service, totalDuration, totalPrice, booking, cancelToken }) {
  const allServices   = normalizeServices(services, service);
  const totalDur      = totalDuration || allServices.reduce((s, x) => s + x.duration_mins, 0);
  const totalPriceVal = totalPrice    || allServices.reduce((s, x) => s + Number(x.price), 0);
  const serviceLabel  = allServices.map(s => s.name).join(' + ');
  const dateStr       = formatDate(booking.booked_at);
  const timeStr       = formatTime(booking.booked_at);

  const serviceRows = allServices.length > 1
    ? allServices.map(s => row(s.name, `${s.duration_mins} min · ${formatPrice(s.price)}`)).join('') + divider()
    : '';

  const detailRows = serviceRows
    + row('Service', serviceLabel)
    + row('Date', dateStr)
    + row('Time', timeStr)
    + row('Duration', `${totalDur} min`)
    + divider()
    + row('Price', formatPrice(totalPriceVal));

  if (client.email) {
    await resend.emails.send({
      from: FROM,
      to: client.email,
      subject: 'Your appointment is confirmed ✦',
      html: baseWrapper(`
        <p style="font-size:16px;color:#3d3d3a;margin:0 0 8px">Hi ${client.name.split(' ')[0]},</p>
        <p style="font-size:14px;color:#993556;margin:0 0 4px">Thank you for booking with us.</p>
        <p style="font-size:14px;color:#993556;margin:0 0 20px">We're delighted to confirm your appointment at Snails Nail Studio.</p>
        ${appointmentBox(detailRows)}
        <p style="font-size:13px;color:#993556;margin:0 0 8px">We kindly ask that you arrive a few minutes early so we can begin your treatment on time.</p>
        <p style="font-size:13px;color:#993556;margin:0 0 20px">Need to reschedule or cancel? Please let us know at least 24 hours in advance.</p>
        ${cancelToken ? `<p style="font-size:12px;color:#d4537e;margin:0 0 20px"><a href="${process.env.API_URL || 'https://snails-api-production.up.railway.app'}/bookings/${cancelToken}/cancel" style="color:#d4537e">Cancel this booking</a></p>` : ''}
        <p style="font-size:14px;color:#72243E;margin:0 0 4px">We can't wait to welcome you ✦</p>
        <p style="font-size:13px;color:#993556;margin:0">Warmly,<br>Snails Nail Studio</p>
      `),
    });
  }

  if (ADMIN_EMAIL) {
    const adminRows = row('Client', client.name)
      + row('Phone', client.phone || '—')
      + row('Email', client.email || '—')
      + divider()
      + row('Service', serviceLabel)
      + row('Date', dateStr)
      + row('Time', timeStr)
      + row('Duration', `${totalDur} min`)
      + divider()
      + row('Price', formatPrice(totalPriceVal));

    await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject: `New booking — ${client.name}`,
      html: baseWrapper(`
        <p style="font-size:16px;font-weight:500;color:#72243E;margin:0 0 16px">New booking received</p>
        ${appointmentBox(adminRows)}
      `),
    });
  }
}

async function sendCancellationEmail({ client, services, service, booking }) {
  if (!client.email) return;
  const allServices  = normalizeServices(services, service);
  const serviceLabel = allServices.length > 0 ? allServices.map(s => s.name).join(' + ') : 'your appointment';
  const dateStr      = formatDate(booking.booked_at);
  const timeStr      = formatTime(booking.booked_at);

  const detailRows = row('Service', serviceLabel)
    + row('Date', dateStr)
    + row('Time', timeStr);

  await resend.emails.send({
    from: FROM,
    to: client.email,
    subject: 'Appointment cancelled',
    html: baseWrapper(`
      <p style="font-size:16px;color:#3d3d3a;margin:0 0 8px">Hi ${client.name.split(' ')[0]},</p>
      <p style="font-size:14px;color:#993556;margin:0 0 20px">This email confirms that your appointment has been cancelled.</p>
      ${appointmentBox(detailRows)}
      <p style="font-size:14px;color:#993556;margin:0 0 8px">We hope to see you again soon.</p>
      <p style="font-size:14px;color:#993556;margin:0 0 20px">Whenever you're ready, you can easily book a new appointment with us.</p>
      <p style="font-size:14px;color:#72243E;margin:0 0 4px">With love, Snails Nail Studio ✦</p>
    `),
  });
}

module.exports = { sendBookingConfirmation, sendCancellationEmail };
