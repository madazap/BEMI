const db = require('../config/db');

function currentPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const Dashboard = {

  async getMonthlyRevenue({ year, month } = {}) {
    const { year: y, month: m } = { ...currentPeriod(), year, month };
    const [rows] = await db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM payments
       WHERE YEAR(paid_at) = ? AND MONTH(paid_at) = ?`,
      [y, m]
    );
    return Number(rows[0].total);
  },

  async getMonthlyExpenses({ year, month } = {}) {
    const { year: y, month: m } = { ...currentPeriod(), year, month };
    const monthStr = `${y}-${String(m).padStart(2, '0')}`;

    const [[fixedRow]] = await db.execute(
      `SELECT COALESCE(SUM(fe.amount), 0) AS total
       FROM fixed_expenses fe
       JOIN expense_categories ec ON ec.id = fe.category_id
       WHERE fe.month = ? AND ec.is_active = 1`,
      [monthStr]
    );

    const [[insumosRow]] = await db.execute(
      `SELECT COALESCE(SUM(total_cost), 0) AS total
       FROM stock_entries
       WHERE YEAR(entry_date) = ? AND MONTH(entry_date) = ?`,
      [y, m]
    );

    const [[laborRow]] = await db.execute(
      `SELECT COALESCE(SUM(s.professional_hours * pr.hourly_rate), 0) AS total
       FROM sessions s
       JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
       JOIN treatments t ON t.id = pt.treatment_id
       JOIN professional_rates pr ON pr.service_type = t.type
         AND pr.effective_from <= s.performed_date
         AND (pr.effective_to IS NULL OR pr.effective_to >= s.performed_date)
       WHERE s.status = 'realizada'
         AND YEAR(s.performed_date) = ? AND MONTH(s.performed_date) = ?`,
      [y, m]
    );

    const fixed    = Number(fixedRow.total);
    const insumos  = Number(insumosRow.total);
    const labor    = Number(laborRow.total);
    return { fixed, insumos, labor, total: fixed + insumos + labor };
  },

  async getSessionsCount({ year, month } = {}) {
    const { year: y, month: m } = { ...currentPeriod(), year, month };
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS total FROM sessions
       WHERE status = 'realizada' AND YEAR(performed_date) = ? AND MONTH(performed_date) = ?`,
      [y, m]
    );
    return Number(row.total);
  },

  async getAppointmentsCount({ year, month } = {}) {
    const { year: y, month: m } = { ...currentPeriod(), year, month };
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS total FROM appointments
       WHERE YEAR(scheduled_at) = ? AND MONTH(scheduled_at) = ?`,
      [y, m]
    );
    return Number(row.total);
  },

  async getRevenueTrend() {
    const [rows] = await db.execute(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, COALESCE(SUM(amount), 0) AS total
       FROM payments
       WHERE paid_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(paid_at, '%Y-%m')
       ORDER BY month ASC`
    );
    return rows.map(r => ({ month: r.month, total: Number(r.total) }));
  },

  async getTreatmentProfitability() {
    const [rows] = await db.execute(
      `SELECT t.name,
              COUNT(sms.id)              AS sessions_count,
              AVG(sms.margin_at_time)    AS avg_margin,
              SUM(sms.margin_at_time)    AS total_margin
       FROM session_margin_snapshots sms
       JOIN treatments t ON t.id = sms.treatment_id
       WHERE sms.recorded_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
       GROUP BY t.id, t.name
       ORDER BY total_margin DESC`
    );
    return rows.map(r => ({
      name:           r.name,
      sessions_count: Number(r.sessions_count),
      avg_margin:     Number(r.avg_margin),
      total_margin:   Number(r.total_margin)
    }));
  },

  // Margen de magistrales facturados: (precio facturado − precio de adquisición al facturar) × cantidad.
  // Agrupa por producto real (el nombre real solo es visible en este panel interno).
  async getMagistralProfitability({ year, month } = {}) {
    const { year: y, month: m } = { ...currentPeriod(), year, month };
    const sel = `
      SELECT p.id, p.generic_name AS name,
             SUM(CASE WHEN ii.item_type = 'magistral' THEN ii.quantity ELSE 0 END) AS units,
             SUM(ii.quantity * ii.unit_price)                AS revenue,
             SUM(ii.quantity * COALESCE(ii.unit_cost, 0))    AS cost,
             SUM(ii.quantity * (ii.unit_price - COALESCE(ii.unit_cost, 0))) AS margin,
             SUM(CASE WHEN ii.item_type = 'magistral' AND ii.unit_cost IS NULL THEN 1 ELSE 0 END) AS lines_without_cost
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      JOIN products p ON p.id = ii.product_id
      -- incluye los descuentos aplicados a líneas de magistral (unit_price negativo, sin costo)
      WHERE ii.item_type IN ('magistral', 'descuento') AND p.is_magistral = 1`;
    const num = r => ({
      name: r.name, units: Number(r.units), revenue: Number(r.revenue), cost: Number(r.cost),
      margin: Number(r.margin), lines_without_cost: Number(r.lines_without_cost)
    });

    const [monthRows] = await db.execute(
      `${sel} AND YEAR(i.created_at) = ? AND MONTH(i.created_at) = ? GROUP BY p.id, p.generic_name`, [y, m]
    );
    const month_ = monthRows.map(num).reduce((a, r) => {
      for (const k of ['units', 'revenue', 'cost', 'margin', 'lines_without_cost']) a[k] += r[k];
      return a;
    }, { units: 0, revenue: 0, cost: 0, margin: 0, lines_without_cost: 0 });

    const [rows] = await db.execute(
      `${sel} AND i.created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
       GROUP BY p.id, p.generic_name ORDER BY margin DESC`
    );
    return { month: month_, byProduct: rows.map(num) };
  },

  async getTopPatients({ year } = {}) {
    const y = year || new Date().getFullYear();
    const [rows] = await db.execute(
      `SELECT p.full_name,
              SUM(py.amount)  AS total_paid,
              COUNT(DISTINCT s.id) AS sessions_count
       FROM payments py
       JOIN invoices i ON i.id = py.invoice_id
       JOIN patients p ON p.id = i.patient_id
       LEFT JOIN sessions s ON s.patient_treatment_id = i.patient_treatment_id
         AND s.status = 'realizada'
       WHERE YEAR(py.paid_at) = ?
       GROUP BY p.id, p.full_name
       ORDER BY total_paid DESC
       LIMIT 5`,
      [y]
    );
    return rows.map(r => ({
      full_name:      r.full_name,
      total_paid:     Number(r.total_paid),
      sessions_count: Number(r.sessions_count)
    }));
  },

  async getPaymentMethods({ year, month } = {}) {
    const { year: y, month: m } = { ...currentPeriod(), year, month };
    const [rows] = await db.execute(
      `SELECT method,
              SUM(amount) AS total,
              COUNT(*)    AS count
       FROM payments
       WHERE YEAR(paid_at) = ? AND MONTH(paid_at) = ?
       GROUP BY method`,
      [y, m]
    );
    return rows.map(r => ({ method: r.method, total: Number(r.total), count: Number(r.count) }));
  }
};

module.exports = Dashboard;
