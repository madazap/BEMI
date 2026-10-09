const db = require('../config/db');

const REMAINING = `(se.consumption_quantity - COALESCE((SELECT SUM(quantity) FROM stock_exits WHERE stock_entry_id = se.id), 0))`;

const CURRENT_STOCK = `(
  COALESCE((SELECT SUM(consumption_quantity) FROM stock_entries WHERE product_id = p.id), 0)
  - COALESCE((SELECT SUM(quantity) FROM stock_exits WHERE product_id = p.id), 0)
)`;

const Stock = {

  async getCurrentStock() {
    const [rows] = await db.execute(`
      SELECT p.id, p.sku, p.generic_name, p.commercial_name,
             p.consumption_unit, p.min_stock,
             ${CURRENT_STOCK} AS current_stock,
             CASE
               WHEN ${CURRENT_STOCK} <= 0             THEN 'empty'
               WHEN ${CURRENT_STOCK} <= p.min_stock   THEN 'low'
               ELSE 'ok'
             END AS stock_status
      FROM products p
      WHERE p.is_active = 1
      ORDER BY stock_status DESC, p.generic_name
    `);
    return rows;
  },

  async getEntriesByProduct(productId) {
    const [rows] = await db.execute(`
      SELECT se.id, se.lot_number, se.expiry_date,
             se.purchase_quantity, se.consumption_quantity,
             se.purchase_price, se.total_cost, se.entry_date,
             ${REMAINING} AS remaining_quantity,
             s.name AS supplier_name,
             u.name AS registered_by_name
      FROM stock_entries se
      LEFT JOIN suppliers s ON s.id = se.supplier_id
      LEFT JOIN users     u ON u.id = se.registered_by
      WHERE se.product_id = ?
      ORDER BY se.entry_date DESC, se.id DESC
    `, [productId]);
    return rows;
  },

  async getLotsByProductFEFO(productId) {
    const [rows] = await db.execute(`
      SELECT se.id, se.lot_number, se.expiry_date,
             ${REMAINING} AS remaining_quantity
      FROM stock_entries se
      WHERE se.product_id = ?
        AND ${REMAINING} > 0
      ORDER BY se.expiry_date ASC, se.id ASC
    `, [productId]);
    return rows;
  },

  // Registra un lote y, en la misma transacción, salda con él los faltantes pendientes del producto
  // (consumos registrados antes sin stock), del más antiguo al más reciente:
  //  - venta de magistral sin stock → stock_exit 'venta' ligado a la línea de factura; baja invoice_items.stock_shortage
  //  - insumo de sesión sin stock   → la fila de session_products sin lote pasa a este lote (se divide si no alcanza)
  //                                   y se crea el stock_exit 'sesion' ligado a la sesión
  // Devuelve { id, settled: [{ type: 'factura'|'sesion', ref, quantity }] }.
  async createEntry({ product_id, supplier_id, lot_number, expiry_date,
                      purchase_quantity, consumption_quantity, purchase_price,
                      total_cost, entry_date, registered_by }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        `INSERT INTO stock_entries
          (product_id, supplier_id, lot_number, expiry_date,
           purchase_quantity, consumption_quantity, purchase_price,
           total_cost, entry_date, registered_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product_id, supplier_id || null, lot_number || null,
          expiry_date || null,
          purchase_quantity, consumption_quantity, purchase_price,
          total_cost, entry_date, registered_by
        ]
      );
      const entryId = result.insertId;

      const [pending] = await conn.execute(`
        SELECT 'factura' AS type, ii.id AS row_id, ii.invoice_id AS ref, ii.stock_shortage AS quantity,
               inv.created_at AS happened_at, NULL AS is_extra
        FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id
        WHERE ii.product_id = ? AND ii.item_type = 'magistral' AND ii.stock_shortage > 0
        UNION ALL
        SELECT 'sesion', sp.id, sp.session_id, sp.quantity, s.performed_date, sp.is_extra
        FROM session_products sp JOIN sessions s ON s.id = sp.session_id
        WHERE sp.product_id = ? AND sp.stock_entry_id IS NULL
        ORDER BY happened_at ASC, row_id ASC
        FOR UPDATE
      `, [product_id, product_id]);

      let available = Number(consumption_quantity);
      const settled = [];
      for (const row of pending) {
        if (available <= 0.00005) break;
        const owed = Number(row.quantity);
        const take = Math.min(owed, available);
        if (row.type === 'factura') {
          await conn.execute(
            `INSERT INTO stock_exits (product_id, stock_entry_id, quantity, exit_date, reason, invoice_item_id, registered_by)
             VALUES (?, ?, ?, ?, 'venta', ?, ?)`,
            [product_id, entryId, take, entry_date, row.row_id, registered_by]
          );
          await conn.execute(
            'UPDATE invoice_items SET stock_shortage = GREATEST(stock_shortage - ?, 0) WHERE id = ?',
            [take, row.row_id]
          );
        } else {
          if (take >= owed - 0.00005) {
            await conn.execute('UPDATE session_products SET stock_entry_id = ? WHERE id = ?', [entryId, row.row_id]);
          } else {
            await conn.execute('UPDATE session_products SET quantity = quantity - ? WHERE id = ?', [take, row.row_id]);
            await conn.execute(
              'INSERT INTO session_products (session_id, product_id, stock_entry_id, quantity, is_extra) VALUES (?, ?, ?, ?, ?)',
              [row.ref, product_id, entryId, take, row.is_extra]
            );
          }
          await conn.execute(
            `INSERT INTO stock_exits (product_id, stock_entry_id, quantity, exit_date, reason, session_id, registered_by)
             VALUES (?, ?, ?, ?, 'sesion', ?, ?)`,
            [product_id, entryId, take, entry_date, row.ref, registered_by]
          );
        }
        settled.push({ type: row.type, ref: row.ref, quantity: take });
        available -= take;
      }

      await conn.commit();
      return { id: entryId, settled };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async getLotRemaining(stockEntryId) {
    const [rows] = await db.execute(
      `SELECT ${REMAINING.replace(/se\./g, 'se.')} AS remaining
       FROM stock_entries se WHERE se.id = ?`,
      [stockEntryId]
    );
    return rows[0] ? Number(rows[0].remaining) : 0;
  },

  async createExit({ product_id, stock_entry_id, quantity, exit_date, reason, registered_by }) {
    const remaining = await this.getLotRemaining(stock_entry_id);
    if (quantity > remaining) {
      throw Object.assign(new Error('Cantidad excede el stock disponible del lote.'), { code: 'INSUFFICIENT_STOCK' });
    }
    const [result] = await db.execute(
      `INSERT INTO stock_exits
        (product_id, stock_entry_id, quantity, exit_date, reason, registered_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [product_id, stock_entry_id, quantity, exit_date, reason, registered_by]
    );
    return result.insertId;
  },

  async getExpiryAlerts() {
    const [rows] = await db.execute(`
      SELECT se.id, se.lot_number, se.expiry_date,
             ${REMAINING} AS remaining_quantity,
             p.id AS product_id, p.generic_name, p.commercial_name,
             p.consumption_unit, p.expiry_alert_days
      FROM stock_entries se
      JOIN products p ON p.id = se.product_id
      WHERE p.is_active = 1
        AND ${REMAINING} > 0
        AND se.expiry_date IS NOT NULL
        AND se.expiry_date <= DATE_ADD(CURDATE(), INTERVAL p.expiry_alert_days DAY)
      ORDER BY se.expiry_date ASC
    `);
    return rows;
  },

  async getLowStockAlerts() {
    const [rows] = await db.execute(`
      SELECT p.id, p.sku, p.generic_name, p.commercial_name,
             p.consumption_unit, p.min_stock,
             ${CURRENT_STOCK} AS current_stock
      FROM products p
      WHERE p.is_active = 1
        AND ${CURRENT_STOCK} <= p.min_stock
      ORDER BY current_stock ASC
    `);
    return rows;
  }
};

module.exports = Stock;
