const db = require('../config/db');

// Segmentos de pacientes (cuadros de resumen). Cada uno es una condición SQL sobre el alias p.
const BALANCE = `(
  COALESCE((SELECT SUM(i.total_amount) FROM invoices i WHERE i.patient_id = p.id), 0)
  - COALESCE((SELECT SUM(pay.amount) FROM payments pay JOIN invoices i ON i.id = pay.invoice_id WHERE i.patient_id = p.id), 0)
)`;
const SEGMENTS = {
  activos:            `EXISTS (SELECT 1 FROM patient_treatments pt WHERE pt.patient_id = p.id AND pt.status = 'activo')`,
  sin_tratamiento:    `NOT EXISTS (SELECT 1 FROM patient_treatments pt WHERE pt.patient_id = p.id AND pt.status = 'activo')`,
  por_agendar:        `EXISTS (SELECT 1 FROM sessions s JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
                               WHERE pt.patient_id = p.id AND pt.status = 'activo'
                                 AND s.status = 'pendiente' AND s.scheduled_date IS NULL)`,
  saldo:              `EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('pendiente','parcial'))`,
  cotizacion_abierta: `EXISTS (SELECT 1 FROM quotations q WHERE q.patient_id = p.id AND q.status IN ('borrador','enviada'))`,
  nuevos:             `p.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
};
const TREATMENT_TYPES = Object.keys(require('../config/constants').TREATMENT_TYPES);

// WHERE compartido por el listado y los contadores (los contadores ignoran el segmento)
function buildWhere({ segment, q, treatmentType, from, to } = {}, { skipSegment = false } = {}) {
  const where  = [];
  const params = [];

  if (segment && !skipSegment && SEGMENTS[segment]) where.push(SEGMENTS[segment]);

  const term = (q || '').toString().trim();
  if (term) {
    where.push('(p.full_name LIKE ? OR p.document_number LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)');
    const like = `%${term}%`;
    params.push(like, like, like, like);
  }

  if (TREATMENT_TYPES.includes(treatmentType)) {
    where.push(`EXISTS (SELECT 1 FROM patient_treatments pt JOIN treatments t ON t.id = pt.treatment_id
                        WHERE pt.patient_id = p.id AND pt.status = 'activo' AND t.type = ?)`);
    params.push(treatmentType);
  }

  if (from) { where.push('DATE(p.created_at) >= ?'); params.push(from); }
  if (to)   { where.push('DATE(p.created_at) <= ?'); params.push(to); }

  return { clause: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

const SORTS = {
  nombre:    'p.full_name ASC',
  recientes: 'p.created_at DESC, p.id DESC',
  antiguos:  'p.created_at ASC, p.id ASC',
  saldo:     'balance DESC, p.full_name ASC'
};

const Patient = {

  SEGMENTS: Object.keys(SEGMENTS),
  TREATMENT_TYPES,

  async findAll(filters = {}) {
    const { clause, params } = buildWhere(filters);
    const order = SORTS[filters.sort] || SORTS.nombre;
    const [rows] = await db.execute(`
      SELECT p.id, p.document_type, p.document_number, p.full_name,
             p.phone, p.email, p.created_at,
             (SELECT COUNT(*) FROM patient_treatments pt WHERE pt.patient_id = p.id AND pt.status = 'activo') AS active_treatments,
             (SELECT COUNT(*) FROM sessions s JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
               WHERE pt.patient_id = p.id AND pt.status = 'activo' AND s.status = 'pendiente') AS pending_sessions,
             (SELECT MAX(s.performed_date) FROM sessions s JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
               WHERE pt.patient_id = p.id AND s.status = 'realizada') AS last_session,
             ${BALANCE} AS balance
      FROM patients p
      ${clause}
      ORDER BY ${order}
    `, params);
    return rows;
  },

  // Conteo por segmento respetando los demás filtros (ignora el segmento elegido)
  async statsBySegment(filters = {}) {
    const { clause, params } = buildWhere(filters, { skipSegment: true });
    const sums = Object.entries(SEGMENTS)
      .map(([key, cond]) => `COALESCE(SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END), 0) AS ${key}`)
      .join(',\n             ');
    const [[row]] = await db.execute(`
      SELECT COUNT(*) AS total,
             ${sums}
      FROM patients p
      ${clause}
    `, params);
    const stats = {};
    Object.keys(row).forEach(k => { stats[k] = Number(row[k]); });
    return stats;
  },

  async findById(id) {
    const [rows] = await db.execute(
      'SELECT * FROM patients WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  async create({ document_type, document_number, full_name, birth_date, phone, email, address }) {
    const [result] = await db.execute(
      `INSERT INTO patients (document_type, document_number, full_name, birth_date, phone, email, address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [document_type, document_number, full_name, birth_date || null, phone || null, email || null, address || null]
    );
    return result.insertId;
  },

  async update(id, { document_type, document_number, full_name, birth_date, phone, email, address }) {
    await db.execute(
      `UPDATE patients SET document_type=?, document_number=?, full_name=?,
       birth_date=?, phone=?, email=?, address=? WHERE id=?`,
      [document_type, document_number, full_name, birth_date || null, phone || null, email || null, address || null, id]
    );
  },

  async search(q, limit = 20) {
    const like = `%${q}%`;
    const [rows] = await db.query(
      `SELECT id, document_type, document_number, full_name, phone, email
       FROM patients
       WHERE full_name LIKE ? OR document_number LIKE ? OR phone LIKE ? OR email LIKE ?
       ORDER BY full_name
       LIMIT ?`,
      [like, like, like, like, limit]
    );
    return rows;
  },

  async findActive() {
    const [rows] = await db.execute(
      'SELECT id, full_name, document_number FROM patients ORDER BY full_name'
    );
    return rows;
  }
};

module.exports = Patient;
