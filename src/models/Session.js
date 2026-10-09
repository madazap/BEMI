const db = require('../config/db');

const REMAINING = `(se.consumption_quantity - COALESCE((SELECT SUM(quantity) FROM stock_exits WHERE stock_entry_id = se.id), 0))`;

const Session = {

  async findById(id) {
    const [rows] = await db.execute(`
      SELECT s.*, pt.patient_id, pt.treatment_id, pt.payment_plan,
             t.name AS treatment_name, t.type AS treatment_type,
             t.sale_price, t.execution_cost,
             p.full_name AS patient_name,
             u.name AS attended_by_name
      FROM sessions s
      JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
      JOIN treatments t          ON t.id  = pt.treatment_id
      JOIN patients   p          ON p.id  = pt.patient_id
      LEFT JOIN users u          ON u.id  = s.attended_by
      WHERE s.id = ?
    `, [id]);
    return rows[0] || null;
  },

  async findByPatientTreatment(ptId) {
    const [rows] = await db.execute(`
      SELECT s.id, s.session_number, s.is_control, s.scheduled_date, s.performed_date,
             s.status, s.professional_hours, s.notes,
             u.name AS attended_by_name
      FROM sessions s
      LEFT JOIN users u ON u.id = s.attended_by
      WHERE s.patient_treatment_id = ?
      ORDER BY s.session_number
    `, [ptId]);
    return rows;
  },

  async getProductsConsumed(sessionId) {
    const [rows] = await db.execute(`
      SELECT sp.quantity, sp.is_extra, sp.stock_entry_id,
             p.generic_name, p.commercial_name, p.consumption_unit,
             se.lot_number
      FROM session_products sp
      JOIN products           p  ON p.id  = sp.product_id
      LEFT JOIN stock_entries se ON se.id = sp.stock_entry_id
      WHERE sp.session_id = ?
      ORDER BY sp.is_extra, p.generic_name, sp.id
    `, [sessionId]);
    return rows;
  },

  async schedule(id, { scheduled_date }) {
    await db.execute(
      'UPDATE sessions SET scheduled_date = ? WHERE id = ?',
      [scheduled_date, id]
    );
  },

  // Realiza la sesión: descuenta los insumos del inventario por FEFO (lote que vence primero).
  // products = [{ product_id, quantity, is_extra }]. Si un producto no tiene stock suficiente,
  // se registra igual: lo disponible sale de los lotes y el faltante queda en session_products
  // con stock_entry_id NULL. Devuelve la lista de advertencias de stock.
  async perform(id, { performed_date, professional_hours, notes, attended_by, products }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [[session]] = await conn.execute(
        `SELECT s.status, s.is_control, s.patient_treatment_id, pt.treatment_id
         FROM sessions s JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
         WHERE s.id = ? FOR UPDATE`,
        [id]
      );
      if (!session) throw Object.assign(new Error('Sesión no encontrada.'), { code: 'NOT_FOUND' });
      if (session.status !== 'pendiente') {
        throw Object.assign(new Error('Esta sesión ya fue realizada o cancelada.'), { code: 'INVALID_STATUS' });
      }

      const warnings = [];
      for (const p of products) {
        let pending = parseFloat(p.quantity);
        if (!(pending > 0)) continue;
        const isExtra = p.is_extra ? 1 : 0;

        // Bloquea los lotes del producto para que dos registros simultáneos no tomen el mismo saldo
        const [lots] = await conn.execute(
          `SELECT se.id, ${REMAINING} AS remaining
           FROM stock_entries se
           WHERE se.product_id = ?
           ORDER BY se.expiry_date IS NULL, se.expiry_date ASC, se.id ASC
           FOR UPDATE`,
          [p.product_id]
        );

        for (const lot of lots) {
          if (pending <= 0.00005) break;
          const take = Math.min(pending, Number(lot.remaining));
          if (take <= 0) continue;
          await conn.execute(
            'INSERT INTO session_products (session_id, product_id, stock_entry_id, quantity, is_extra) VALUES (?, ?, ?, ?, ?)',
            [id, p.product_id, lot.id, take, isExtra]
          );
          await conn.execute(
            `INSERT INTO stock_exits (product_id, stock_entry_id, quantity, exit_date, reason, session_id, registered_by)
             VALUES (?, ?, ?, ?, 'sesion', ?, ?)`,
            [p.product_id, lot.id, take, performed_date, id, attended_by]
          );
          pending -= take;
        }

        if (pending > 0.00005) {
          await conn.execute(
            'INSERT INTO session_products (session_id, product_id, stock_entry_id, quantity, is_extra) VALUES (?, ?, NULL, ?, ?)',
            [id, p.product_id, pending, isExtra]
          );
          const [[info]] = await conn.execute(
            'SELECT generic_name, consumption_unit FROM products WHERE id = ?', [p.product_id]
          );
          warnings.push(`${info ? info.generic_name : 'Producto #' + p.product_id}: faltaron ${+pending.toFixed(4)} ${info?.consumption_unit || ''}`.trim());
        }
      }

      await conn.execute(
        `UPDATE sessions SET status='realizada', performed_date=?, professional_hours=?, notes=?, attended_by=? WHERE id=?`,
        [performed_date, professional_hours || null, notes || null, attended_by, id]
      );

      // El control va incluido en el precio del tratamiento: no genera snapshot de margen
      if (!session.is_control) {
        const [[treatment]] = await conn.execute(
          'SELECT sale_price, execution_cost, margin FROM treatments WHERE id = ?',
          [session.treatment_id]
        );
        await conn.execute(
          `INSERT INTO session_margin_snapshots (session_id, treatment_id, sale_price_at_time, execution_cost_at_time, margin_at_time)
           VALUES (?, ?, ?, ?, ?)`,
          [id, session.treatment_id, treatment.sale_price, treatment.execution_cost, treatment.margin]
        );
      }

      // Plan completado cuando no le quedan sesiones pendientes
      const [[{ pendingSessions }]] = await conn.execute(
        `SELECT COUNT(*) AS pendingSessions FROM sessions WHERE patient_treatment_id = ? AND status = 'pendiente'`,
        [session.patient_treatment_id]
      );
      if (pendingSessions === 0) {
        await conn.execute(
          `UPDATE patient_treatments SET status = 'completado' WHERE id = ? AND status = 'activo'`,
          [session.patient_treatment_id]
        );
      }

      await conn.commit();
      return warnings;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // Nombre visible de la sesión: "Control" o "Sesión N"
  label(s) {
    return s.is_control ? 'Control' : `Sesión ${s.session_number}`;
  },

  async cancel(id) {
    await db.execute(`UPDATE sessions SET status='cancelada' WHERE id = ?`, [id]);
  },

  async getSnapshot(sessionId) {
    const [rows] = await db.execute(
      'SELECT * FROM session_margin_snapshots WHERE session_id = ?',
      [sessionId]
    );
    return rows[0] || null;
  }
};

module.exports = Session;
