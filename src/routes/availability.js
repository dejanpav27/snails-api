const router = require('express').Router();
const db = require('../db');

const SLOT_STEP = 30;

function generateSlots(date, openHour, openMin, closeHour, closeMin) {
  const slots = [];
  for (let h = openHour; h <= closeHour; h++) {
    for (let m = 0; m < 60; m += SLOT_STEP) {
      if (h === openHour && m < openMin) continue;
      if (h === closeHour && m >= closeMin) continue;
      const slot = new Date(date);
      slot.setHours(h, m, 0, 0);
      slots.push(slot);
    }
  }
  return slots;
}

// GET /availability?date=YYYY-MM-DD&service_ids=id1,id2 (or legacy &service_id=id)
router.get('/', async (req, res) => {
  const { date, service_ids, service_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });

  // Support both single and multiple service IDs
  const serviceIds = service_ids
    ? service_ids.split(',').map(s => s.trim()).filter(Boolean)
    : service_id ? [service_id] : [];
  if (!serviceIds.length) return res.status(400).json({ error: 'service_ids or service_id is required' });

  const targetDate = new Date(date);
  if (isNaN(targetDate.getTime())) return res.status(400).json({ error: 'Invalid date' });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (targetDate < today) return res.status(400).json({ error: 'Cannot book in the past' });

  try {
    const dayOfWeek = targetDate.getDay();
    const scheduleResult = await db.query('SELECT * FROM schedule WHERE day_of_week = $1', [dayOfWeek]);
    if (scheduleResult.rowCount === 0 || !scheduleResult.rows[0].is_open) {
      return res.json({ date, available_slots: [], closed: true });
    }

    const schedule = scheduleResult.rows[0];
    const [openHour, openMin]   = schedule.open_time.split(':').map(Number);
    const [closeHour, closeMin] = schedule.close_time.split(':').map(Number);

    // Get all selected services and sum duration
    const placeholders = serviceIds.map((_, i) => `$${i + 1}`).join(',');
    const servicesResult = await db.query(
      `SELECT * FROM services WHERE id IN (${placeholders}) AND active = TRUE`,
      serviceIds
    );
    if (servicesResult.rowCount !== serviceIds.length) {
      return res.status(404).json({ error: 'One or more services not found' });
    }
    const totalDuration = servicesResult.rows.reduce((sum, s) => sum + s.duration_mins, 0);

    // Get existing bookings that day
    // FIX: Use LEFT JOIN so multi-service bookings (no service_id) are not dropped.
    // Duration priority: total_duration_mins -> sum from booking_services -> single service duration
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const bookingsResult = await db.query(
      `SELECT b.booked_at,
              COALESCE(
                b.total_duration_mins,
                (SELECT SUM(s2.duration_mins)
                 FROM booking_services bs
                 JOIN services s2 ON s2.id = bs.service_id
                 WHERE bs.booking_id = b.id),
                s.duration_mins
              ) AS duration_mins
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.booked_at BETWEEN $1 AND $2
         AND b.status != 'cancelled'`,
      [dayStart.toISOString(), dayEnd.toISOString()]
    );

    // 3 hour buffer for same-day bookings
    const now = new Date();
    const minimumStart = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    const allSlots = generateSlots(targetDate, openHour, openMin, closeHour, closeMin);

    const freeSlots = allSlots.filter((slot) => {
      const slotStart = slot.getTime();
      const slotEnd   = slotStart + totalDuration * 60 * 1000;

      if (slotStart < minimumStart.getTime()) return false;

      const closing = new Date(slot); closing.setHours(closeHour, closeMin, 0, 0);
      if (slotEnd > closing.getTime()) return false;

      for (const b of bookingsResult.rows) {
        const bStart = new Date(b.booked_at).getTime();
        const bEnd   = bStart + b.duration_mins * 60 * 1000;
        if (slotStart < bEnd && slotEnd > bStart) return false;
      }

      return true;
    });

    res.json({
      date,
      total_duration_mins: totalDuration,
      available_slots: freeSlots.map(s => s.toISOString()),
    });
  } catch (err) {
    console.error('Availability error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
