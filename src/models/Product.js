const db = require('../config/db');

const STOCK_EXPR = `(
  COALESCE((SELECT SUM(consumption_quantity) FROM stock_entries WHERE product_id = p.id), 0)
  - COALESCE((SELECT SUM(quantity) FROM stock_exits WHERE product_id = p.id), 0)
)`;

// Saldo de un lote (alias se) en unidades de consumo
const LOT_REMAINING = `(se.consumption_quantity - COALESCE((SELECT SUM(sx.quantity) FROM stock_exits sx WHERE sx.stock_entry_id = se.id), 0))`;

// Segmentos (cuadros de resumen). Los de stock y vencimiento solo aplican a productos activos.
const SEGMENTS = {
  stock_ok:    `p.is_active = 1 AND ${STOCK_EXPR} > 0 AND (p.min_stock = 0 OR ${STOCK_EXPR} > p.min_stock)`,
  bajo_minimo: `p.is_active = 1 AND p.min_stock > 0 AND ${STOCK_EXPR} > 0 AND ${STOCK_EXPR} <= p.min_stock`,
  sin_stock:   `p.is_active = 1 AND ${STOCK_EXPR} <= 0`,
  por_vencer:  `p.is_active = 1 AND EXISTS (SELECT 1 FROM stock_entries se WHERE se.product_id = p.id
                  AND se.expiry_date >= CURDATE()
                  AND se.expiry_date <= DATE_ADD(CURDATE(), INTERVAL p.expiry_alert_days DAY)
                  AND ${LOT_REMAINING} > 0)`,
  vencidos:    `p.is_active = 1 AND EXISTS (SELECT 1 FROM stock_entries se WHERE se.product_id = p.id
                  AND se.expiry_date < CURDATE() AND ${LOT_REMAINING} > 0)`,
  inactivos:   `p.is_active = 0`
};

// WHERE compartido por el listado y los contadores (los contadores ignoran el segmento)
function buildWhere({ segment, type, supplierId, search } = {}, { skipSegment = false } = {}) {
  const where  = [];
  const params = [];

  if (segment && !skipSegment && SEGMENTS[segment]) where.push(SEGMENTS[segment]);
  if (type === 'magistral') where.push('p.is_magistral = 1');
  if (type === 'insumo')    where.push('p.is_magistral = 0');

  if (supplierId) {
    where.push('EXISTS (SELECT 1 FROM stock_entries se WHERE se.product_id = p.id AND se.supplier_id = ?)');
    params.push(supplierId);
  }

  const term = (search || '').toString().trim();
  if (term) {
    where.push('(p.sku LIKE ? OR p.generic_name LIKE ? OR p.commercial_name LIKE ? OR p.manufacturer LIKE ?)');
    const like = `%${term}%`;
    params.push(like, like, like, like);
  }

  return { clause: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

const SORTS = {
  nombre:      'p.generic_name ASC',
  stock:       'current_stock ASC, p.generic_name ASC',
  vencimiento: 'next_expiry IS NULL, next_expiry ASC, p.generic_name ASC',
  valor:       'stock_value DESC, p.generic_name ASC'
};

const Product = {

  SEGMENTS: Object.keys(SEGMENTS),

  async findAll(filters = {}) {
    const { clause, params } = buildWhere(filters);
    const order = SORTS[filters.sort] || SORTS.nombre;
    const [rows] = await db.execute(`
      SELECT p.*,
             ${STOCK_EXPR} AS current_stock,
             (SELECT MIN(se.expiry_date) FROM stock_entries se
               WHERE se.product_id = p.id AND ${LOT_REMAINING} > 0) AS next_expiry,
             COALESCE((SELECT SUM(${LOT_REMAINING} * se.purchase_price) FROM stock_entries se
               WHERE se.product_id = p.id AND ${LOT_REMAINING} > 0), 0) AS stock_value
      FROM products p
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
      FROM products p
      ${clause}
    `, params);
    const stats = {};
    Object.keys(row).forEach(k => { stats[k] = Number(row[k]); });
    return stats;
  },

  async findById(id) {
    const [rows] = await db.execute(
      `SELECT p.*, ${STOCK_EXPR} AS current_stock FROM products p WHERE p.id = ?`,
      [id]
    );
    return rows[0] || null;
  },

  async findActive() {
    const [rows] = await db.execute(
      'SELECT id, generic_name, commercial_name, sku, is_magistral FROM products WHERE is_active = 1 ORDER BY generic_name'
    );
    return rows;
  },

  // Insumos (no magistrales) activos con su stock actual, para el consumo en sesiones
  async findConsumablesWithStock() {
    const [rows] = await db.execute(`
      SELECT p.id, p.sku, p.generic_name, p.commercial_name, p.consumption_unit,
             ${STOCK_EXPR} AS current_stock
      FROM products p
      WHERE p.is_active = 1 AND p.is_magistral = 0
      ORDER BY p.generic_name
    `);
    return rows;
  },

  async findMagistralActive() {
    const [rows] = await db.execute(
      'SELECT id, generic_name, commercial_name, sale_price FROM products WHERE is_active = 1 AND is_magistral = 1 ORDER BY generic_name'
    );
    return rows;
  },

  async findForApi(id) {
    const [rows] = await db.execute(
      'SELECT id, conversion_factor, purchase_unit, consumption_unit FROM products WHERE id = ? AND is_active = 1',
      [id]
    );
    return rows[0] || null;
  },

  async create(data) {
    const [result] = await db.execute(
      `INSERT INTO products
        (sku, generic_name, commercial_name, presentation, concentration,
         manufacturer, sanitary_registry, purchase_unit, consumption_unit,
         conversion_factor, min_stock, expiry_alert_days,
         is_magistral, sale_price, acquisition_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.sku, data.generic_name, data.commercial_name || null,
        data.presentation || null, data.concentration || null,
        data.manufacturer || null, data.sanitary_registry || null,
        data.purchase_unit, data.consumption_unit,
        data.conversion_factor, data.min_stock, data.expiry_alert_days,
        data.is_magistral ? 1 : 0,
        data.is_magistral ? (data.sale_price || null) : null,
        data.is_magistral ? (data.acquisition_price || null) : null
      ]
    );
    return result.insertId;
  },

  async update(id, data) {
    await db.execute(
      `UPDATE products SET
        sku = ?, generic_name = ?, commercial_name = ?, presentation = ?,
        concentration = ?, manufacturer = ?, sanitary_registry = ?,
        purchase_unit = ?, consumption_unit = ?, conversion_factor = ?,
        min_stock = ?, expiry_alert_days = ?,
        is_magistral = ?, sale_price = ?, acquisition_price = ?
       WHERE id = ?`,
      [
        data.sku, data.generic_name, data.commercial_name || null,
        data.presentation || null, data.concentration || null,
        data.manufacturer || null, data.sanitary_registry || null,
        data.purchase_unit, data.consumption_unit,
        data.conversion_factor, data.min_stock, data.expiry_alert_days,
        data.is_magistral ? 1 : 0,
        data.is_magistral ? (data.sale_price || null) : null,
        data.is_magistral ? (data.acquisition_price || null) : null,
        id
      ]
    );
  },

  async toggleActive(id) {
    await db.execute(
      'UPDATE products SET is_active = NOT is_active WHERE id = ?',
      [id]
    );
  }
};

module.exports = Product;
