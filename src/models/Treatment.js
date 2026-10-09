const db = require('../config/db');

const TYPES = Object.keys(require('../config/constants').TREATMENT_TYPES);
const LOW_MARGIN_PCT = 30;

// Segmentos (cuadros de resumen). Condiciones SQL sobre el alias t.
const SEGMENTS = {
  activos:      `t.is_active = 1`,
  con_planes:   `EXISTS (SELECT 1 FROM patient_treatments pt WHERE pt.treatment_id = t.id AND pt.status = 'activo')`,
  sin_insumos:  `t.is_active = 1 AND NOT EXISTS (SELECT 1 FROM treatment_products tp WHERE tp.treatment_id = t.id)`,
  margen_bajo:  `t.is_active = 1 AND (t.sale_price <= 0 OR t.margin < t.sale_price * ${LOW_MARGIN_PCT} / 100)`,
  inactivos:    `t.is_active = 0`
};

// WHERE compartido por el listado y los contadores (los contadores ignoran el segmento)
function buildWhere({ segment, type, search } = {}, { skipSegment = false } = {}) {
  const where  = [];
  const params = [];
  if (segment && !skipSegment && SEGMENTS[segment]) where.push(SEGMENTS[segment]);
  if (TYPES.includes(type)) { where.push('t.type = ?'); params.push(type); }
  const term = (search || '').toString().trim();
  if (term) {
    where.push('(t.name LIKE ? OR t.description LIKE ?)');
    params.push(`%${term}%`, `%${term}%`);
  }
  return { clause: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

const SORTS = {
  tipo:         't.type ASC, t.name ASC',
  nombre:       't.name ASC',
  margen_desc:  'margin_pct DESC, t.name ASC',
  margen_asc:   'margin_pct ASC, t.name ASC',
  mas_vendidos: 'plans_total DESC, t.name ASC'
};

const Treatment = {

  TYPES,
  LOW_MARGIN_PCT,
  SEGMENTS: Object.keys(SEGMENTS),

  async findAll(filters = {}) {
    const { clause, params } = buildWhere(filters);
    const order = SORTS[filters.sort] || SORTS.tipo;
    const [rows] = await db.execute(`
      SELECT t.id, t.name, t.type, t.description, t.total_sessions, t.requires_control,
             t.sale_price, t.execution_cost, t.margin, t.is_active,
             CASE WHEN t.sale_price > 0 THEN t.margin / t.sale_price * 100 ELSE NULL END AS margin_pct,
             (SELECT COUNT(*) FROM treatment_products tp WHERE tp.treatment_id = t.id) AS supplies_count,
             (SELECT COUNT(*) FROM patient_treatments pt WHERE pt.treatment_id = t.id AND pt.status = 'activo') AS active_plans,
             (SELECT COUNT(*) FROM patient_treatments pt WHERE pt.treatment_id = t.id) AS plans_total
      FROM treatments t
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
      FROM treatments t
      ${clause}
    `, params);
    const stats = {};
    Object.keys(row).forEach(k => { stats[k] = Number(row[k]); });
    return stats;
  },

  async findById(id) {
    const [rows] = await db.execute(
      'SELECT * FROM treatments WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  async findActive() {
    const [rows] = await db.execute(
      'SELECT id, name, type, total_sessions, requires_control, sale_price, execution_cost FROM treatments WHERE is_active = 1 ORDER BY type, name'
    );
    return rows;
  },

  async create({ name, type, description, total_sessions, requires_control, sale_price, execution_cost }) {
    const [result] = await db.execute(
      `INSERT INTO treatments (name, type, description, total_sessions, requires_control, sale_price, execution_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, type, description || null, total_sessions, requires_control ? 1 : 0, sale_price, execution_cost]
    );
    return result.insertId;
  },

  async update(id, { name, type, description, total_sessions, requires_control, sale_price, execution_cost }) {
    await db.execute(
      `UPDATE treatments SET name=?, type=?, description=?, total_sessions=?, requires_control=?,
       sale_price=?, execution_cost=? WHERE id=?`,
      [name, type, description || null, total_sessions, requires_control ? 1 : 0, sale_price, execution_cost, id]
    );
  },

  async toggleActive(id) {
    await db.execute('UPDATE treatments SET is_active = NOT is_active WHERE id = ?', [id]);
  },

  async getCurrentRate(type) {
    const [rows] = await db.execute(
      'SELECT hourly_rate FROM professional_rates WHERE service_type = ? AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1',
      [type]
    );
    return rows[0] ? Number(rows[0].hourly_rate) : 0;
  }
};

module.exports = Treatment;
