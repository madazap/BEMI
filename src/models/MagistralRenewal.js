const db = require('../config/db');
const { MAGISTRAL_DAYS_PER_UNIT, MAGISTRAL_ALERT_DAYS } = require('../config/constants');

const DAY = 86400000;
const toDay = d => { const x = new Date(d); return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()); };
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

// Compras de magistrales a partir de la facturación (todas las facturas, pagadas o no).
// Una fila por factura + magistral: cantidad y valor facturado neto (incluye descuentos de esa línea).
async function fetchPurchases(patientId = null) {
  const [rows] = await db.execute(`
    SELECT i.patient_id, pa.full_name AS patient_name, i.id AS invoice_id, i.created_at AS purchased_at,
           p.id AS product_id, p.generic_name, p.commercial_name, p.consumption_unit,
           SUM(CASE WHEN ii.item_type = 'magistral' THEN ii.quantity ELSE 0 END) AS quantity,
           SUM(ii.quantity * ii.unit_price) AS amount
    FROM invoice_items ii
    JOIN invoices i  ON i.id  = ii.invoice_id
    JOIN patients pa ON pa.id = i.patient_id
    JOIN products p  ON p.id  = ii.product_id
    WHERE ii.item_type IN ('magistral', 'descuento') AND p.is_magistral = 1
      ${patientId ? 'AND i.patient_id = ?' : ''}
    GROUP BY i.id, p.id
    HAVING quantity > 0
    ORDER BY i.created_at ASC, i.id ASC
  `, patientId ? [patientId] : []);
  return rows.map(r => ({ ...r, quantity: Number(r.quantity), amount: Number(r.amount) }));
}

async function fetchDismissals(patientId = null) {
  const [rows] = await db.execute(
    `SELECT patient_id, product_id, dismissed_at FROM magistral_renewal_dismissals ${patientId ? 'WHERE patient_id = ?' : ''}`,
    patientId ? [patientId] : []
  );
  const map = new Map();
  rows.forEach(r => map.set(`${r.patient_id}:${r.product_id}`, r.dismissed_at));
  return map;
}

// Resumen por paciente + magistral. Cobertura encadenada: cada compra suma 30 días por unidad
// a partir del fin de la cobertura anterior (o de la fecha de compra, si ya había terminado).
function summarize(purchases, dismissals, today = new Date()) {
  const todayMs = toDay(today);
  const groups = new Map();
  for (const pu of purchases) {
    const key = `${pu.patient_id}:${pu.product_id}`;
    let g = groups.get(key);
    if (!g) {
      g = { patient_id: pu.patient_id, patient_name: pu.patient_name, product_id: pu.product_id,
            generic_name: pu.generic_name, commercial_name: pu.commercial_name, consumption_unit: pu.consumption_unit,
            total_quantity: 0, total_amount: 0, purchases: 0, coverageEnd: null, last: null };
      groups.set(key, g);
    }
    const day = toDay(pu.purchased_at);
    const start = g.coverageEnd && g.coverageEnd > day ? g.coverageEnd : day;
    g.coverageEnd = start + pu.quantity * MAGISTRAL_DAYS_PER_UNIT * DAY;
    g.total_quantity += pu.quantity;
    g.total_amount += pu.amount;
    g.purchases++;
    g.last = pu;
  }

  return [...groups.values()].map(g => {
    const dismissedAt = dismissals.get(`${g.patient_id}:${g.product_id}`);
    const dismissed = dismissedAt && new Date(dismissedAt) >= new Date(g.last.purchased_at);
    const daysLeft = Math.round((g.coverageEnd - todayMs) / DAY);
    const status = dismissed ? 'no_renovar'
                 : daysLeft < 0 ? 'vencida'
                 : daysLeft <= MAGISTRAL_ALERT_DAYS ? 'por_renovar'
                 : 'vigente';
    return {
      patient_id: g.patient_id, patient_name: g.patient_name, product_id: g.product_id,
      generic_name: g.generic_name, commercial_name: g.commercial_name, consumption_unit: g.consumption_unit,
      purchases: g.purchases, total_quantity: g.total_quantity, total_amount: g.total_amount,
      last_purchase_at: g.last.purchased_at, last_quantity: g.last.quantity, last_invoice_id: g.last.invoice_id,
      renewal_date: isoDay(g.coverageEnd), days_left: daysLeft, status,
      dismissed_at: dismissed ? dismissedAt : null
    };
  });
}

const STATUS_ORDER = { vencida: 0, por_renovar: 1, vigente: 2, no_renovar: 3 };

const MagistralRenewal = {

  DAYS_PER_UNIT: MAGISTRAL_DAYS_PER_UNIT,
  ALERT_DAYS:    MAGISTRAL_ALERT_DAYS,

  // Ficha del paciente: resumen por magistral + historial de compras (más reciente primero)
  async forPatient(patientId) {
    const [purchases, dismissals] = await Promise.all([fetchPurchases(patientId), fetchDismissals(patientId)]);
    const summary = summarize(purchases, dismissals)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.days_left - b.days_left);
    return { summary, purchases: purchases.slice().reverse() };
  },

  // Alertas de todos los pacientes (por renovar y vencidas, sin las marcadas "No renovar")
  async pendingAlerts() {
    const [purchases, dismissals] = await Promise.all([fetchPurchases(), fetchDismissals()]);
    return summarize(purchases, dismissals)
      .filter(s => s.status === 'por_renovar' || s.status === 'vencida')
      .sort((a, b) => a.days_left - b.days_left);
  },

  async dismiss(patientId, productId, userId) {
    await db.execute(
      `INSERT INTO magistral_renewal_dismissals (patient_id, product_id, dismissed_at, dismissed_by)
       VALUES (?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE dismissed_at = NOW(), dismissed_by = VALUES(dismissed_by)`,
      [patientId, productId, userId]
    );
  },

  async reactivate(patientId, productId) {
    await db.execute(
      'DELETE FROM magistral_renewal_dismissals WHERE patient_id = ? AND product_id = ?',
      [patientId, productId]
    );
  }
};

module.exports = MagistralRenewal;
