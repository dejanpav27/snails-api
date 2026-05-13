const router = require('express').Router();
const db = require('../db');

const WORK_START = 9;
const WORK_END   = 18;
const SLOT_STEP  = 30;

function generateSlots(date) {
  const slots = [];
  for (let h = WORK_START; h < WORK_END; h++) {
    for (let m = 0; m < 60; m += SLOT_STEP) {
      const slot = new Date(date);
      slot.setHours(h, m, 0, 0);
      slots.push(slot);
    }
  }
  return slots;
}

router.get('/', async (req, res) => {
  const { date, service_id } = req.query;
  if (!date || !service_id) return res.status(400).json({ error: 'date and service_id are required' });

  const targetDate = new Date(date);
  if (isNaN(targetDate.getTime())) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (targetDate < today) return res.status(400).json({ error: 'Cannot book in the past' });

  try {
    const serviceResult = await db.query('SELECT duration_mins FROM services WHERE id = $1 AND active = TRUE', [service_id]);
    if (serviceResult.rowCount === 0) return res.status(404).json({ error: 'Service not found' });
    const duration = serviceResult.rows[0].duration_mins;

    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const bookingsResult = await db.query(
      `SELECT b.booked_at, s.duration_mins FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.booked_at BETWEEN $1 AND $2 AND b.status != 'cancelled'`,
      [dayStart.toISOString(), dayEnd.toISOString()]
    );

    const allSlots = generateSlots(targetDate);
    const freeSlots = allSlots.filter((slot) => {
      const slotStart = slot.getTime();
      const slotEnd   = slotStart + duration * 60 * 1000;
      const closing   = new Date(slot); closing.setHours(WORK_END, 0, 0, 0);
      if (slotEnd > closing.getTime()) return false;
      for (const b of bookingsResult.rows) {
        const bStart = new Date(b.booked_at).getTime();
        const bEnd   = bStart + b.duration_mins * 60 * 1000;
        if (slotStart < bEnd && slotEnd > bStart) return false;
      }
      return true;
    });

    res.json({ date, service_id, duration_mins: duration, available_slots: freeSlots.map(s => s.toISOString()) });
  } catch (err) {
    console.error('Availability error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
