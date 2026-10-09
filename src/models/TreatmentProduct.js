const db = require('../config/db');

const STOCK_EXPR = `(
  COALESCE((SELECT SUM(consumption_quantity) FROM stock_entries WHERE product_id = p.id), 0)
  - COALESCE((SELECT SUM(quantity) FROM stock_exits WHERE product_id = p.id), 0)
)`;

const TreatmentProduct = {

  async findByTreatment(treatmentId) {
    const [rows] = await db.execute(`
      SELECT tp.id, tp.product_id, tp.quantity,
             p.generic_name, p.commercial_name, p.consumption_unit,
             ${STOCK_EXPR} AS current_stock
      FROM treatment_products tp
      JOIN products p ON p.id = tp.product_id
      WHERE tp.treatment_id = ?
      ORDER BY p.generic_name
    `, [treatmentId]);
    return rows;
  },

  async set(treatmentId, products) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM treatment_products WHERE treatment_id = ?', [treatmentId]);
      for (const p of products) {
        const qty = parseFloat(p.quantity);
        if (p.product_id && qty > 0) {
          await conn.execute(
            'INSERT INTO treatment_products (treatment_id, product_id, quantity) VALUES (?, ?, ?)',
            [treatmentId, p.product_id, qty]
          );
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
};

module.exports = TreatmentProduct;
