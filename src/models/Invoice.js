const db = require('../config/db');
const { MAGISTRAL_LABEL } = require('../config/constants');

const LOT_REMAINING = `(se.consumption_quantity - COALESCE((SELECT SUM(quantity) FROM stock_exits WHERE stock_entry_id = se.id), 0))`;

const INVOICE_STATUSES = ['pendiente', 'parcial', 'pagado'];
const STATUS_GROUPS = { con_saldo: ['pendiente', 'parcial'] };
const PAID    = `COALESCE((SELECT SUM(pay.amount) FROM payments pay WHERE pay.invoice_id = i.id), 0)`;
const PAY_METHODS = ['efectivo', 'transferencia', 'datafono'];

// WHERE compartido por el listado y los contadores por estado
function buildWhere({ patientId, status, from, to, minAgeDays, method, search } = {}, { skipStatus = false } = {}) {
  const where  = [];
  const params = [];

  if (patientId) { where.push('i.patient_id = ?'); params.push(patientId); }

  if (status && !skipStatus) {
    const group = STATUS_GROUPS[status] || (INVOICE_STATUSES.includes(status) ? [status] : null);
    if (group) {
      where.push(`i.status IN (${group.map(() => '?').join(',')})`);
      params.push(...group);
    }
  }

  if (from) { where.push('DATE(i.created_at) >= ?'); params.push(from); }
  if (to)   { where.push('DATE(i.created_at) <= ?'); params.push(to); }

  // Antigüedad: facturas con saldo que llevan más de N días
  const age = parseInt(minAgeDays, 10);
  if (Number.isInteger(age) && age > 0) {
    // entero ya validado: se interpola porque MySQL no acepta placeholder dentro de INTERVAL
    where.push(`i.status IN ('pendiente','parcial') AND i.created_at <= DATE_SUB(CURDATE(), INTERVAL ${age} DAY)`);
  }

  if (PAY_METHODS.includes(method)) {
    where.push('EXISTS (SELECT 1 FROM payments pm WHERE pm.invoice_id = i.id AND pm.method = ?)');
    params.push(method);
  }

  const term = (search || '').toString().trim().replace(/^#/, '');
  if (term) {
    if (/^\d+$/.test(term)) {
      where.push('(i.id = ? OR p.document_number LIKE ? OR p.full_name LIKE ?)');
      params.push(term, `%${term}%`, `%${term}%`);
    } else {
      where.push('p.full_name LIKE ?');
      params.push(`%${term}%`);
    }
  }

  return { clause: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

const SORTS = {
  recientes: 'i.created_at DESC, i.id DESC',
  antiguas:  'i.created_at ASC, i.id ASC',
  saldo:     'balance DESC, i.created_at ASC'
};

const Invoice = {

  STATUSES: INVOICE_STATUSES,
  PAY_METHODS,

  async findAll(filters = {}) {
    const { clause, params } = buildWhere(filters);
    const order = SORTS[filters.sort] || SORTS.recientes;
    const [rows] = await db.execute(`
      SELECT i.id, i.total_amount, i.status, i.created_at,
             p.full_name AS patient_name, p.document_type, p.document_number,
             DATEDIFF(CURDATE(), i.created_at) AS days_old,
             ${PAID} AS total_paid,
             (i.total_amount - ${PAID}) AS balance
      FROM invoices i
      JOIN patients p ON p.id = i.patient_id
      ${clause}
      ORDER BY ${order}
    `, params);
    return rows;
  },

  // Conteo y montos por estado respetando los demás filtros (ignora el filtro de estado)
  async statsByStatus(filters = {}) {
    const { clause, params } = buildWhere(filters, { skipStatus: true });
    const [rows] = await db.execute(`
      SELECT i.status, COUNT(*) AS n,
             COALESCE(SUM(i.total_amount), 0) AS total,
             COALESCE(SUM(i.total_amount - ${PAID}), 0) AS balance
      FROM invoices i
      JOIN patients p ON p.id = i.patient_id
      ${clause}
      GROUP BY i.status
    `, params);
    const blank = () => ({ count: 0, total: 0, balance: 0 });
    const stats = { all: blank(), con_saldo: blank() };
    INVOICE_STATUSES.forEach(st => { stats[st] = blank(); });
    rows.forEach(r => {
      const v = { count: Number(r.n), total: Number(r.total), balance: Number(r.balance) };
      stats[r.status] = v;
      for (const k of ['count', 'total', 'balance']) {
        stats.all[k] += v[k];
        if (STATUS_GROUPS.con_saldo.includes(r.status)) stats.con_saldo[k] += v[k];
      }
    });
    return stats;
  },

  async findById(id) {
    const [[invoice]] = await db.execute(`
      SELECT i.*, p.full_name AS patient_name,
             p.document_type AS patient_document_type, p.document_number AS patient_document,
             p.email AS patient_email,
             t.name AS treatment_name
      FROM invoices i
      JOIN patients p ON p.id = i.patient_id
      LEFT JOIN patient_treatments pt ON pt.id = i.patient_treatment_id
      LEFT JOIN treatments t          ON t.id = pt.treatment_id
      WHERE i.id = ?
    `, [id]);
    if (!invoice) return null;

    const [items] = await db.execute(
      `SELECT ii.*, pr.generic_name AS magistral_real_name
       FROM invoice_items ii
       LEFT JOIN products pr ON pr.id = ii.product_id
       WHERE ii.invoice_id = ? ORDER BY ii.id`,
      [id]
    );
    const payments = await Invoice.getPayments(id);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

    invoice.items    = items;
    invoice.payments = payments;
    invoice.totalPaid    = totalPaid;
    invoice.totalPending = Number(invoice.total_amount) - totalPaid;
    return invoice;
  },

  // Crea la factura. Devuelve { id, warnings }: warnings lista los magistrales facturados sin stock suficiente.
  async create({ patient_id, patient_treatment_id, items, created_by }) {
    const totalAmount = items.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        `INSERT INTO invoices (patient_id, patient_treatment_id, total_amount)
         VALUES (?, ?, ?)`,
        [patient_id, patient_treatment_id || null, totalAmount]
      );
      const invId = result.insertId;
      const warnings = [];
      for (const item of items) {
        const isMagistral = item.item_type === 'magistral';
        // Norma colombiana: el consultorio no es farmacia, no factura medicamentos por nombre.
        const description = isMagistral ? MAGISTRAL_LABEL : item.description;

        const [itemResult] = await conn.execute(
          `INSERT INTO invoice_items
             (invoice_id, item_type, session_id, product_id, description, quantity, unit_price)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [invId, item.item_type, item.session_id || null, item.product_id || null,
           description, item.quantity, item.unit_price]
        );

        if (isMagistral && item.product_id) {
          const r = await Invoice._consumeMagistralStock(conn, {
            product_id: item.product_id,
            quantity: Number(item.quantity),
            invoice_item_id: itemResult.insertId,
            registered_by: created_by
          });
          await conn.execute(
            'UPDATE invoice_items SET unit_cost = ?, stock_shortage = ? WHERE id = ?',
            [r.unit_cost, r.shortage, itemResult.insertId]
          );
          if (r.shortage > 0) warnings.push(`${r.name}: faltaron ${+r.shortage.toFixed(4)} ${r.unit || ''}`.trim());
        }
      }
      await conn.commit();
      return { id: invId, warnings };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // Descuenta stock FEFO del magistral facturado. Se permite facturar sin stock suficiente:
  // sale lo disponible y el faltante se devuelve para registrarlo en invoice_items.stock_shortage.
  // También devuelve el precio de adquisición vigente (snapshot para el margen).
  async _consumeMagistralStock(conn, { product_id, quantity, invoice_item_id, registered_by }) {
    // No confiar solo en item_type: verificar que el producto realmente sea magistral
    // antes de tocar su stock, para que un insumo normal jamás se consuma por esta vía.
    const [[product]] = await conn.execute(
      'SELECT is_magistral, generic_name, consumption_unit, acquisition_price FROM products WHERE id = ?',
      [product_id]
    );
    if (!product || !product.is_magistral) {
      throw Object.assign(
        new Error('El producto indicado no está marcado como magistral; no se puede facturar por esta vía.'),
        { code: 'NOT_MAGISTRAL' }
      );
    }

    const [lots] = await conn.execute(
      `SELECT se.id, ${LOT_REMAINING} AS remaining
       FROM stock_entries se
       WHERE se.product_id = ?
       ORDER BY se.expiry_date IS NULL, se.expiry_date ASC, se.id ASC
       FOR UPDATE`,
      [product_id]
    );

    let pending = quantity;
    for (const lot of lots) {
      if (pending <= 0.00005) break;
      const take = Math.min(pending, Number(lot.remaining));
      if (take <= 0) continue;
      await conn.execute(
        `INSERT INTO stock_exits (product_id, stock_entry_id, quantity, reason, invoice_item_id, registered_by)
         VALUES (?, ?, ?, 'venta', ?, ?)`,
        [product_id, lot.id, take, invoice_item_id, registered_by]
      );
      pending -= take;
    }

    return {
      name:      product.generic_name,
      unit:      product.consumption_unit,
      unit_cost: product.acquisition_price === null ? null : Number(product.acquisition_price),
      shortage:  pending > 0.00005 ? pending : 0
    };
  },

  // Convierte las líneas de una cotización en líneas de factura. Los descuentos (por línea y global)
  // se agregan como líneas aparte (item_type='descuento', unit_price negativo), con la misma
  // fórmula de Quotation.calcTotal, de modo que el total de la factura = total de la cotización.
  // Se usa también para la vista previa al crear la factura.
  linesFromQuotation(quotation, qItems) {
    const round2 = n => Math.round(n * 100) / 100;
    const pctText = (type, value) => type === 'porcentaje' ? ` ${+Number(value)}%` : '';
    const lines = [];
    const discounts = [];
    let subtotal = 0;

    for (const qi of qItems) {
      const isMag = qi.item_type === 'magistral';
      const label = isMag ? MAGISTRAL_LABEL : qi.description;
      lines.push({
        item_type:   qi.item_type,
        session_id:  null,
        product_id:  qi.product_id || null,
        description: qi.description,
        quantity:    Number(qi.quantity),
        unit_price:  Number(qi.unit_price),
        real_name:   isMag ? (qi.product_name || null) : null
      });
      const lineSub  = Number(qi.quantity) * Number(qi.unit_price);
      const lineDisc = qi.discount_type === 'porcentaje' ? lineSub * Number(qi.discount_value) / 100
                     : qi.discount_type === 'valor_fijo' ? Number(qi.discount_value) : 0;
      if (lineDisc > 0) {
        discounts.push({
          item_type:   'descuento',
          session_id:  null,
          product_id:  isMag ? (qi.product_id || null) : null,   // para restar del margen del magistral
          description: `Descuento${pctText(qi.discount_type, qi.discount_value)} — ${label}`,
          quantity:    1,
          unit_price:  -round2(lineDisc)
        });
      }
      subtotal += lineSub - lineDisc;
    }

    const gDisc = quotation.discount_type === 'porcentaje' ? subtotal * Number(quotation.discount_value) / 100
                : quotation.discount_type === 'valor_fijo' ? Number(quotation.discount_value) : 0;
    if (gDisc > 0) {
      discounts.push({
        item_type:   'descuento',
        session_id:  null,
        product_id:  null,
        description: `Descuento global${pctText(quotation.discount_type, quotation.discount_value)}`,
        quantity:    1,
        unit_price:  -round2(gDisc)
      });
    }
    return [...lines, ...discounts];
  },

  async createFromQuotation(quotationId, { patient_treatment_id, created_by }) {
    const [[quotation]] = await db.execute(
      'SELECT * FROM quotations WHERE id = ? AND status = ?',
      [quotationId, 'aprobada']
    );
    if (!quotation) throw new Error('Cotización no encontrada o no aprobada');

    const [qItems] = await db.execute(
      'SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id',
      [quotationId]
    );
    const items = Invoice.linesFromQuotation(quotation, qItems);
    return Invoice.create({ patient_id: quotation.patient_id, patient_treatment_id, items, created_by });
  },

  async addPayment({ invoice_id, amount, method, registered_by }) {
    await db.execute(
      'INSERT INTO payments (invoice_id, amount, method, registered_by) VALUES (?, ?, ?, ?)',
      [invoice_id, amount, method, registered_by]
    );
    await Invoice.recalcStatus(invoice_id);
  },

  async recalcStatus(invoiceId) {
    const [[inv]]   = await db.execute('SELECT total_amount FROM invoices WHERE id = ?', [invoiceId]);
    const [[paid]]  = await db.execute('SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id = ?', [invoiceId]);
    const totalPaid = Number(paid.total);
    const total     = Number(inv.total_amount);
    const status    = totalPaid >= total ? 'pagado' : totalPaid > 0 ? 'parcial' : 'pendiente';
    await db.execute('UPDATE invoices SET status = ? WHERE id = ?', [status, invoiceId]);
  },

  async findPaymentsByRange(from, to) {
    const [rows] = await db.execute(
      `SELECT pay.id, pay.paid_at AS date, pay.amount, pay.method,
              p.full_name AS patient_name,
              t.name      AS treatment_name
       FROM payments pay
       JOIN invoices i ON i.id = pay.invoice_id
       JOIN patients p ON p.id = i.patient_id
       LEFT JOIN patient_treatments pt ON pt.id = i.patient_treatment_id
       LEFT JOIN treatments t          ON t.id  = pt.treatment_id
       WHERE pay.paid_at BETWEEN ? AND ?
       ORDER BY pay.paid_at`,
      [from, to]
    );
    return rows;
  },

  async getPayments(invoiceId) {
    const [rows] = await db.execute(
      `SELECT pay.*, u.name AS registered_by_name
       FROM payments pay
       JOIN users u ON u.id = pay.registered_by
       WHERE pay.invoice_id = ?
       ORDER BY pay.paid_at`,
      [invoiceId]
    );
    return rows;
  },

  // Cuentas por cobrar: facturas con saldo pendiente, agrupadas por paciente.
  async findReceivables({ minAgeDays, search, sort } = {}) {
    const where  = [`i.status IN ('pendiente','parcial')`];
    const params = [];

    const age = parseInt(minAgeDays, 10);
    if (Number.isInteger(age) && age > 0) {
      // entero ya validado: se interpola porque MySQL no acepta placeholder dentro de INTERVAL
      where.push(`i.created_at <= DATE_SUB(CURDATE(), INTERVAL ${age} DAY)`);
    }

    const term = (search || '').toString().trim();
    if (term) {
      where.push('(p.full_name LIKE ? OR p.document_number LIKE ?)');
      params.push(`%${term}%`, `%${term}%`);
    }

    const [rows] = await db.execute(`
      SELECT i.id, i.created_at, i.total_amount,
             p.id AS patient_id, p.full_name AS patient_name,
             p.phone, p.email, p.document_number,
             t.name AS treatment_name,
             COALESCE(SUM(pay.amount), 0) AS total_paid,
             DATEDIFF(CURDATE(), i.created_at) AS days_old
      FROM invoices i
      JOIN patients p ON p.id = i.patient_id
      LEFT JOIN patient_treatments pt ON pt.id = i.patient_treatment_id
      LEFT JOIN treatments t          ON t.id  = pt.treatment_id
      LEFT JOIN payments pay          ON pay.invoice_id = i.id
      WHERE ${where.join(' AND ')}
      GROUP BY i.id
      ORDER BY i.created_at ASC
    `, params);

    // Agrupar facturas por paciente
    const byPatient = new Map();
    for (const r of rows) {
      const pending = Number(r.total_amount) - Number(r.total_paid);
      if (pending <= 0.009) continue; // seguridad: el status ya debería garantizar saldo > 0

      if (!byPatient.has(r.patient_id)) {
        byPatient.set(r.patient_id, {
          patient_id:      r.patient_id,
          patient_name:    r.patient_name,
          phone:           r.phone,
          email:           r.email,
          document_number: r.document_number,
          total_pending:   0,
          oldest_days:     0,
          invoices:        []
        });
      }
      const group = byPatient.get(r.patient_id);
      group.total_pending += pending;
      group.oldest_days    = Math.max(group.oldest_days, r.days_old);
      group.invoices.push({
        id:             r.id,
        created_at:     r.created_at,
        treatment_name: r.treatment_name,
        total_amount:   Number(r.total_amount),
        total_paid:     Number(r.total_paid),
        pending,
        days_old:       r.days_old
      });
    }

    const patients = Array.from(byPatient.values());
    if (sort === 'antiguedad') {
      patients.sort((a, b) => b.oldest_days - a.oldest_days);
    } else {
      patients.sort((a, b) => b.total_pending - a.total_pending);
    }

    const summary = {
      total_pending:  patients.reduce((s, p) => s + p.total_pending, 0),
      patient_count:  patients.length,
      invoice_count:  patients.reduce((s, p) => s + p.invoices.length, 0)
    };

    return { patients, summary };
  }
};

module.exports = Invoice;
