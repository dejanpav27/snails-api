const router = require('express').Router();
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    // Monthly revenue last 6 months
    const monthlyRevenue = await db.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', booked_at), 'Mon') AS month,
             DATE_TRUNC('month', booked_at) AS month_date,
             COALESCE(SUM(total_price), 0)::numeric AS revenue,
             COUNT(*) AS bookings
      FROM bookings
      WHERE status IN ('confirmed', 'no_show')
        AND booked_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', booked_at)
      ORDER BY month_date ASC
    `);

    // This month stats
    const thisMonth = await db.query(`
      SELECT COALESCE(SUM(total_price), 0)::numeric AS revenue,
             COUNT(*) AS bookings,
             COALESCE(AVG(total_price), 0)::numeric AS avg_value,
             COUNT(*) FILTER (WHERE status = 'no_show') AS no_shows,
             COUNT(*) FILTER (WHERE status = 'cancelled') AS cancellations
      FROM bookings
      WHERE DATE_TRUNC('month', booked_at) = DATE_TRUNC('month', NOW())
        AND status IN ('confirmed', 'no_show', 'cancelled')
    `);

    // Last month stats (for comparison)
    const lastMonth = await db.query(`
      SELECT COALESCE(SUM(total_price), 0)::numeric AS revenue,
             COUNT(*) FILTER (WHERE status IN ('confirmed','no_show')) AS bookings,
             COALESCE(AVG(total_price) FILTER (WHERE status IN ('confirmed','no_show')), 0)::numeric AS avg_value
      FROM bookings
      WHERE DATE_TRUNC('month', booked_at) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND status IN ('confirmed', 'no_show', 'cancelled')
    `);

    // Weekly breakdown this month
    const weeklyBreakdown = await db.query(`
      SELECT DATE_TRUNC('week', booked_at) AS week_start,
             COALESCE(SUM(total_price), 0)::numeric AS revenue,
             COUNT(*) AS bookings
      FROM bookings
      WHERE status IN ('confirmed', 'no_show')
        AND DATE_TRUNC('month', booked_at) = DATE_TRUNC('month', NOW())
      GROUP BY DATE_TRUNC('week', booked_at)
      ORDER BY week_start ASC
    `);

    // Top services last 3 months
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

    // Busiest days
    const busyDays = await db.query(`
      SELECT TO_CHAR(booked_at, 'Dy') AS day,
             EXTRACT(DOW FROM booked_at) AS dow,
             COUNT(*) AS bookings
      FROM bookings
      WHERE status IN ('confirmed', 'no_show')
        AND booked_at >= NOW() - INTERVAL '3 months'
      GROUP BY day, dow
      ORDER BY dow ASC
    `);

    // Top clients by spend
    const topClients = await db.query(`
      SELECT c.name, c.id,
             COUNT(b.id) AS visits,
             SUM(b.total_price)::numeric AS total_spend,
             MAX(b.booked_at) AS last_visit
      FROM clients c
      JOIN bookings b ON b.client_id = c.id
      WHERE b.status IN ('confirmed', 'no_show')
      GROUP BY c.id, c.name
      ORDER BY total_spend DESC
      LIMIT 5
    `);

    // Avg days between visits (returning clients)
    const avgReturn = await db.query(`
      SELECT ROUND(AVG(gap_days)) AS avg_days
      FROM (
        SELECT client_id,
               EXTRACT(DAY FROM booked_at - LAG(booked_at) OVER (PARTITION BY client_id ORDER BY booked_at)) AS gap_days
        FROM bookings
        WHERE status IN ('confirmed', 'no_show')
      ) t
      WHERE gap_days IS NOT NULL AND gap_days > 0 AND gap_days < 180
    `);

    // New vs returning this month
    const clientTypes = await db.query(`
      SELECT
        COUNT(DISTINCT CASE WHEN client_booking_count = 1 THEN client_id END) AS new_clients,
        COUNT(DISTINCT CASE WHEN client_booking_count > 1 THEN client_id END) AS returning_clients
      FROM (
        SELECT b.client_id, COUNT(*) OVER (PARTITION BY b.client_id) AS client_booking_count
        FROM bookings b
        WHERE b.status IN ('confirmed', 'no_show')
          AND DATE_TRUNC('month', b.booked_at) = DATE_TRUNC('month', NOW())
      ) t
    `);

    res.json({
      monthly_revenue:  monthlyRevenue.rows,
      this_month:       thisMonth.rows[0],
      last_month:       lastMonth.rows[0],
      weekly_breakdown: weeklyBreakdown.rows,
      top_services:     topServices.rows,
      busy_days:        busyDays.rows,
      top_clients:      topClients.rows,
      avg_return_days:  avgReturn.rows[0]?.avg_days || null,
      client_types:     clientTypes.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
