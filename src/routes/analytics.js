const router = require('express').Router();
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    // Last 6 months revenue (confirmed + no_show bookings)
    const monthlyRevenue = await db.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', booked_at), 'Mon') AS month,
        DATE_TRUNC('month', booked_at) AS month_date,
        COALESCE(SUM(total_price), 0)::numeric AS revenue,
        COUNT(*) AS bookings
      FROM bookings
      WHERE status IN ('confirmed', 'no_show')
        AND booked_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', booked_at)
      ORDER BY month_date ASC
    `);

    // Top services by booking count
    const topServices = await db.query(`
      SELECT s.name, COUNT(*) AS bookings, SUM(s.price)::numeric AS revenue
      FROM booking_services bs
      JOIN services s ON s.id = bs.service_id
      JOIN bookings b ON b.id = bs.booking_id
      WHERE b.status IN ('confirmed', 'no_show')
        AND b.booked_at >= NOW() - INTERVAL '3 months'
      GROUP BY s.name
      ORDER BY bookings DESC
      LIMIT 5
    `);

    // Busiest days of week
    const busyDays = await db.query(`
      SELECT
        TO_CHAR(booked_at, 'Dy') AS day,
        EXTRACT(DOW FROM booked_at) AS dow,
        COUNT(*) AS bookings
      FROM bookings
      WHERE status IN ('confirmed', 'no_show')
        AND booked_at >= NOW() - INTERVAL '3 months'
      GROUP BY day, dow
      ORDER BY dow ASC
    `);

    // This month stats
    const thisMonth = await db.query(`
      SELECT
        COALESCE(SUM(total_price), 0)::numeric AS revenue,
        COUNT(*) AS bookings,
        COALESCE(AVG(total_price), 0)::numeric AS avg_value
      FROM bookings
      WHERE status IN ('confirmed', 'no_show')
        AND DATE_TRUNC('month', booked_at) = DATE_TRUNC('month', NOW())
    `);

    // New vs returning clients this month
    const clientTypes = await db.query(`
      SELECT
        COUNT(DISTINCT CASE WHEN client_booking_count = 1 THEN client_id END) AS new_clients,
        COUNT(DISTINCT CASE WHEN client_booking_count > 1 THEN client_id END) AS returning_clients
      FROM (
        SELECT
          b.client_id,
          COUNT(*) OVER (PARTITION BY b.client_id) AS client_booking_count
        FROM bookings b
        WHERE b.status IN ('confirmed', 'no_show')
          AND DATE_TRUNC('month', b.booked_at) = DATE_TRUNC('month', NOW())
      ) t
    `);

    // No-show rate this month
    const noShowRate = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'no_show') AS no_shows,
        COUNT(*) FILTER (WHERE status IN ('confirmed', 'no_show')) AS total
      FROM bookings
      WHERE DATE_TRUNC('month', booked_at) = DATE_TRUNC('month', NOW())
    `);

    res.json({
      monthly_revenue: monthlyRevenue.rows,
      top_services:    topServices.rows,
      busy_days:       busyDays.rows,
      this_month:      thisMonth.rows[0],
      client_types:    clientTypes.rows[0],
      no_show_rate:    noShowRate.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
