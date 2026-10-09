const db = require('../config/db');

const STATUSES = ['borrador', 'enviada', 'aprobada', 'rechazada', 'facturada'];

// Grupos de estados para seguimiento de cotizaciones no aceptadas
const STATUS_GROUPS = {
  sin_aprobar:  ['borrador', 'enviada'],              // aún en juego, pendientes de respuesta
  no_aceptadas: ['borrador', 'enviada', 'rechazada']  // todo lo que no terminó en venta
};

// Construye el WHERE compartido por el listado y los contadores por estado
function buildWhere({ patientId, status, from, to, minAgeDays, search } = {}, { skipStatus = false } = {}) {
  const where  = [];
  const params = [];

  if (patientId) { where.push('q.patient_id = ?'); params.push(patientId); }

  if (status && !skipStatus) {
    const group = STATUS_GROUPS[status];
    if (group) {
      where.push(`q.status IN (${group.map(() => '?').join(',')})`);
      params.push(...group);
    } else if (STATUSES.includes(status)) {
      where.push('q.status = ?');
      params.push(status);
    }
  }

  if (from) { where.push('DATE(q.created_at) >= ?'); params.push(from); }
  if (to)   { where.push('DATE(q.created_at) <= ?'); params.push(to); }

  const age = parseInt(minAgeDays, 10);
  if (Number.isInteger(age) && age > 0) {
    // entero ya validado: se interpola porque MySQL no acepta placeholder dentro de INTERVAL
    where.push(`q.created_at <= DATE_SUB(CURDATE(), INTERVAL ${age} DAY)`);
  }

  const term = (search || '').toString().trim().replace(/^#/, '');
  if (term) {
    if (/^\d+$/.test(term)) {
      where.push('(q.id = ? OR p.full_name LIKE ?)');
      params.push(term, `%${term}%`);
    } else {
      where.push('p.full_name LIKE ?');
      params.push(`%${term}%`);
    }
  }

  return { clause: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

const Quotation = {

  STATUSES,
  STATUS_GROUPS,

  async findAll(filters = {}) {
    const { clause, params } = buildWhere(filters);
    const order = filters.sort === 'antiguas' ? 'ASC' : 'DESC';
    const sql = `
      SELECT q.id, q.status, q.discount_type, q.discount_value, q.created_at,
             p.full_name AS patient_name,
             DATEDIFF(CURDATE(), q.created_at) AS days_old,
             COUNT(qi.id) AS item_count,
             COALESCE(SUM(qi.quantity * qi.unit_price), 0) AS subtotal_items
      FROM quotations q
      JOIN patients p ON p.id = q.patient_id
      LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
      ${clause}
      GROUP BY q.id
      ORDER BY q.created_at ${order}
    `;
    const [rows] = await db.execute(sql, params);
    return rows.map(r => ({ ...r, total: Quotation.calcTotal([], r.discount_type, r.discount_value, r.subtotal_items) }));
  },

  // Conteo por estado respetando los demás filtros (ignora el filtro de estado)
  async statsByStatus(filters = {}) {
    const { clause, params } = buildWhere(filters, { skipStatus: true });
    const [rows] = await db.execute(`
      SELECT q.status, COUNT(*) AS total_count
      FROM quotations q
      JOIN patients p ON p.id = q.patient_id
      ${clause}
      GROUP BY q.status
    `, params);

    const stats = { total: 0 };
    STATUSES.forEach(s => { stats[s] = 0; });
    rows.forEach(r => {
      stats[r.status] = Number(r.total_count);
      stats.total    += Number(r.total_count);
    });
    stats.sin_aprobar  = STATUS_GROUPS.sin_aprobar.reduce((acc, s) => acc + stats[s], 0);
    stats.no_aceptadas = STATUS_GROUPS.no_aceptadas.reduce((acc, s) => acc + stats[s], 0);
    return stats;
  },


  async findById(id) {
    const [[quotation]] = await db.execute(`
      SELECT q.*, p.full_name AS patient_name, p.id AS patient_id,
             p.document_type AS patient_document_type, p.document_number AS patient_document,
             p.email AS patient_email,
             u.name AS created_by_name
      FROM quotations q
      JOIN patients p ON p.id = q.patient_id
      JOIN users u    ON u.id = q.created_by
      WHERE q.id = ?
    `, [id]);
    if (!quotation) return null;

    const [items] = await db.execute(`
      SELECT qi.*,
             t.name  AS treatment_name,
             t.total_sessions AS treatment_total_sessions, t.requires_control,
             pr.generic_name AS product_name,
             pt.id AS plan_id,
             (SELECT COUNT(*) FROM sessions s WHERE s.patient_treatment_id = pt.id) AS plan_sessions_total,
             (SELECT COUNT(*) FROM sessions s WHERE s.patient_treatment_id = pt.id AND s.status = 'realizada') AS plan_sessions_done
      FROM quotation_items qi
      LEFT JOIN treatments t  ON t.id = qi.treatment_id
      LEFT JOIN products   pr ON pr.id = qi.product_id
      LEFT JOIN patient_treatments pt ON pt.quotation_item_id = qi.id
      WHERE qi.quotation_id = ?
      ORDER BY qi.id
    `, [id]);

    items.forEach(it => {
      if (it.item_type === 'sesion' && it.treatment_id) it.sessions_to_create = Quotation.sessionsForItem(it);
    });
    quotation.items = items;
    quotation.total = Quotation.calcTotal(items, quotation.discount_type, quotation.discount_value);
    return quotation;
  },

  async create({ patient_id, notes, discount_type, discount_value, items, created_by }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        `INSERT INTO quotations (patient_id, notes, discount_type, discount_value, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [patient_id, notes || null, discount_type || null, discount_value || 0, created_by]
      );
      const qId = result.insertId;
      for (const item of items) {
        await conn.execute(
          `INSERT INTO quotation_items
             (quotation_id, item_type, treatment_id, product_id, description, quantity, unit_price, discount_type, discount_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [qId, item.item_type, item.treatment_id || null, item.product_id || null,
           item.description, item.quantity, item.unit_price,
           item.discount_type || null, item.discount_value || 0]
        );
      }
      await conn.commit();
      return qId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async update(id, { notes, discount_type, discount_value, items }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE quotations SET notes = ?, discount_type = ?, discount_value = ?
         WHERE id = ? AND status = 'borrador'`,
        [notes || null, discount_type || null, discount_value || 0, id]
      );
      await conn.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [id]);
      for (const item of items) {
        await conn.execute(
          `INSERT INTO quotation_items
             (quotation_id, item_type, treatment_id, product_id, description, quantity, unit_price, discount_type, discount_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, item.item_type, item.treatment_id || null, item.product_id || null,
           item.description, item.quantity, item.unit_price,
           item.discount_type || null, item.discount_value || 0]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async updateStatus(id, status) {
    await db.execute('UPDATE quotations SET status = ? WHERE id = ?', [status, id]);
  },

  // Cambia el estado solo si el actual está en `from`. Devuelve true si hubo cambio.
  async transition(id, from, to) {
    const [result] = await db.query(
      'UPDATE quotations SET status = ? WHERE id = ? AND status IN (?)',
      [to, id, from]
    );
    return result.affectedRows > 0;
  },

  // Sesiones a crear por cada línea de tratamiento: sesiones del catálogo × cantidad cotizada.
  sessionsForItem(item) {
    return Math.max(1, Math.round(Number(item.treatment_total_sessions || 1) * Number(item.quantity || 1)));
  },

  // Aprueba la cotización y crea, para cada línea de tipo sesión, un plan de tratamiento
  // con sus sesiones en estado 'pendiente'. Todo en una sola transacción.
  async approve(id, { created_by }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[quotation]] = await conn.execute(
        'SELECT id, patient_id, status FROM quotations WHERE id = ? FOR UPDATE', [id]
      );
      if (!quotation || quotation.status !== 'enviada') {
        throw Object.assign(new Error('Solo se pueden aprobar cotizaciones enviadas.'), { code: 'INVALID_STATUS' });
      }

      const [items] = await conn.execute(`
        SELECT qi.id, qi.treatment_id, qi.quantity, t.total_sessions AS treatment_total_sessions, t.requires_control
        FROM quotation_items qi
        JOIN treatments t ON t.id = qi.treatment_id
        WHERE qi.quotation_id = ? AND qi.item_type = 'sesion'
          AND NOT EXISTS (SELECT 1 FROM patient_treatments pt WHERE pt.quotation_item_id = qi.id)
        ORDER BY qi.id
      `, [id]);

      let plans = 0, sessions = 0;
      for (const item of items) {
        const [pt] = await conn.execute(
          `INSERT INTO patient_treatments
             (patient_id, treatment_id, payment_plan, status, start_date, quotation_id, quotation_item_id, created_by)
           VALUES (?, ?, 'paquete', 'activo', CURDATE(), ?, ?, ?)`,
          [quotation.patient_id, item.treatment_id, id, item.id, created_by]
        );
        const n = Quotation.sessionsForItem(item);
        for (let i = 1; i <= n; i++) {
          await conn.execute(
            `INSERT INTO sessions (patient_treatment_id, session_number, status) VALUES (?, ?, 'pendiente')`,
            [pt.insertId, i]
          );
        }
        // Un solo control al final del plan, sin importar la cantidad cotizada
        if (item.requires_control) {
          await conn.execute(
            `INSERT INTO sessions (patient_treatment_id, session_number, is_control, status) VALUES (?, ?, 1, 'pendiente')`,
            [pt.insertId, n + 1]
          );
        }
        plans++;
        sessions += n + (item.requires_control ? 1 : 0);
      }

      await conn.execute(`UPDATE quotations SET status = 'aprobada' WHERE id = ?`, [id]);
      await conn.commit();
      return { plans, sessions };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async markAsBilled(id, invoiceId) {
    await db.execute(
      'UPDATE quotations SET status = ?, invoice_id = ? WHERE id = ?',
      ['facturada', invoiceId, id]
    );
  },

  calcTotal(items, discountType, discountValue, precomputedSubtotal = null) {
    let subtotal;
    if (precomputedSubtotal !== null) {
      subtotal = Number(precomputedSubtotal);
    } else {
      subtotal = items.reduce((acc, item) => {
        const lineSubtotal = Number(item.quantity) * Number(item.unit_price);
        const lineDiscount = item.discount_type === 'porcentaje'
          ? lineSubtotal * Number(item.discount_value) / 100
          : item.discount_type === 'valor_fijo' ? Number(item.discount_value) : 0;
        return acc + (lineSubtotal - lineDiscount);
      }, 0);
    }
    const globalDiscount = discountType === 'porcentaje'
      ? subtotal * Number(discountValue) / 100
      : discountType === 'valor_fijo' ? Number(discountValue) : 0;
    return subtotal - globalDiscount;
  }
};

module.exports = Quotation;
