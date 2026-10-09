const { validationResult } = require('express-validator');
const Stock   = require('../models/Stock');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');

const stockController = {

  async index(req, res) {
    try {
      const [stockList, expiryAlerts, lowStockAlerts] = await Promise.all([
        Stock.getCurrentStock(),
        Stock.getExpiryAlerts(),
        Stock.getLowStockAlerts()
      ]);
      res.render('inventory/index', {
        title: 'Inventario',
        stockList,
        expiryAlerts,
        lowStockAlerts
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el inventario.');
      res.redirect('/dashboard');
    }
  },

  async showEntry(req, res) {
    try {
      const [products, suppliers] = await Promise.all([
        Product.findActive(),
        Supplier.findActive()
      ]);
      const today = new Date().toISOString().split('T')[0];
      res.render('inventory/entry', { title: 'Registrar Ingreso', products, suppliers, today });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el formulario.');
      res.redirect('/inventario');
    }
  },

  async createEntry(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/inventario/ingresos/nuevo');
    }

    const product = await Product.findById(req.body.product_id);
    if (!product) {
      req.flash('error', 'Producto no encontrado.');
      return res.redirect('/inventario/ingresos/nuevo');
    }

    const purchase_quantity    = parseFloat(req.body.purchase_quantity);
    const purchase_price       = parseFloat(req.body.purchase_price);
    const consumption_quantity = parseFloat((purchase_quantity * product.conversion_factor).toFixed(4));
    const total_cost           = parseFloat((consumption_quantity * purchase_price).toFixed(2));

    try {
      const { settled } = await Stock.createEntry({
        product_id:           product.id,
        supplier_id:          req.body.supplier_id || null,
        lot_number:           req.body.lot_number || null,
        expiry_date:          req.body.expiry_date || null,
        purchase_quantity,
        consumption_quantity,
        purchase_price,
        total_cost,
        entry_date:           req.body.entry_date,
        registered_by:        req.session.userId
      });
      if (settled.length) {
        const total  = settled.reduce((a, s) => a + s.quantity, 0);
        const detail = settled.map(s => `${s.type === 'factura' ? 'Factura' : 'Sesión'} #${s.ref}: ${+s.quantity.toFixed(4)}`).join(', ');
        req.flash('success', `Ingreso de lote registrado. Se descontaron ${+total.toFixed(4)} ${product.consumption_unit} de faltantes pendientes (${detail}).`);
      } else {
        req.flash('success', 'Ingreso de lote registrado correctamente.');
      }
      res.redirect('/inventario');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al registrar el ingreso.');
      res.redirect('/inventario/ingresos/nuevo');
    }
  },

  async showEntriesByProduct(req, res) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).render('404', { title: 'No encontrado' });
      const entries = await Stock.getEntriesByProduct(req.params.id);
      res.render('inventory/lots', { title: `Lotes — ${product.generic_name}`, product, entries });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar los lotes.');
      res.redirect('/inventario');
    }
  },

  async showExitForm(req, res) {
    try {
      const products = await Product.findActive();
      res.render('inventory/exit', { title: 'Registrar Salida', products });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el formulario.');
      res.redirect('/inventario');
    }
  },

  async createExit(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/inventario/salidas/nuevo');
    }

    try {
      await Stock.createExit({
        product_id:    parseInt(req.body.product_id),
        stock_entry_id: parseInt(req.body.stock_entry_id),
        quantity:      parseFloat(req.body.quantity),
        exit_date:     req.body.exit_date,
        reason:        req.body.reason,
        registered_by: req.session.userId
      });
      req.flash('success', 'Salida registrada correctamente.');
      res.redirect('/inventario');
    } catch (err) {
      if (err.code === 'INSUFFICIENT_STOCK') {
        req.flash('error', err.message);
      } else {
        console.error(err);
        req.flash('error', 'Error al registrar la salida.');
      }
      res.redirect('/inventario/salidas/nuevo');
    }
  },

  async apiLotsByProduct(req, res) {
    try {
      const lots = await Stock.getLotsByProductFEFO(req.params.id);
      res.json(lots);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error interno' });
    }
  },

  async movements(req, res) {
    try {
      const db       = require('../config/db');
      const { from, to, product_id, type } = req.query;

      const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
      const dateTo   = to   || new Date().toISOString().slice(0, 10);

      // Entradas
      let entriesSQL = `
        SELECT
          'entrada' AS mov_type,
          se.entry_date AS mov_date,
          p.id AS product_id, p.generic_name, p.commercial_name, p.consumption_unit,
          se.lot_number, se.expiry_date,
          se.consumption_quantity AS quantity,
          se.purchase_price AS unit_cost,
          se.total_cost,
          NULL AS reason,
          NULL AS patient_name,
          NULL AS session_id,
          s.name AS supplier_name,
          u.name AS registered_by
        FROM stock_entries se
        JOIN products p   ON p.id  = se.product_id
        LEFT JOIN suppliers s ON s.id = se.supplier_id
        LEFT JOIN users u     ON u.id = se.registered_by
        WHERE DATE(se.entry_date) BETWEEN ? AND ?
      `;
      const entryParams = [dateFrom, dateTo];
      if (product_id) { entriesSQL += ' AND se.product_id = ?'; entryParams.push(product_id); }

      // Salidas
      let exitsSQL = `
        SELECT
          'salida' AS mov_type,
          sx.exit_date AS mov_date,
          p.id AS product_id, p.generic_name, p.commercial_name, p.consumption_unit,
          se.lot_number, se.expiry_date,
          sx.quantity,
          NULL AS unit_cost,
          NULL AS total_cost,
          sx.reason,
          COALESCE(pat.full_name, pat_inv.full_name) AS patient_name,
          sx.session_id,
          inv.id AS invoice_id,
          NULL AS supplier_name,
          u.name AS registered_by
        FROM stock_exits sx
        JOIN products      p   ON p.id   = sx.product_id
        JOIN stock_entries se  ON se.id  = sx.stock_entry_id
        LEFT JOIN sessions     ss  ON ss.id  = sx.session_id
        LEFT JOIN patient_treatments pt ON pt.id = ss.patient_treatment_id
        LEFT JOIN patients     pat ON pat.id = pt.patient_id
        LEFT JOIN invoice_items ii  ON ii.id  = sx.invoice_item_id
        LEFT JOIN invoices      inv ON inv.id = ii.invoice_id
        LEFT JOIN patients     pat_inv ON pat_inv.id = inv.patient_id
        LEFT JOIN users        u   ON u.id  = sx.registered_by
        WHERE DATE(sx.exit_date) BETWEEN ? AND ?
      `;
      const exitParams = [dateFrom, dateTo];
      if (product_id) { exitsSQL += ' AND sx.product_id = ?'; exitParams.push(product_id); }
      if (type === 'sesion' || type === 'vencimiento' || type === 'ajuste' || type === 'venta') {
        exitsSQL += ' AND sx.reason = ?'; exitParams.push(type);
      }

      // Faltantes: consumos registrados sin stock disponible (no generan stock_exits).
      // - venta de magistral facturada sin stock → invoice_items.stock_shortage
      // - insumo usado en sesión sin stock      → session_products con stock_entry_id NULL
      let shortageSQL = `
        SELECT 'faltante' AS mov_type, inv.created_at AS mov_date,
               p.id AS product_id, p.generic_name, p.commercial_name, p.consumption_unit,
               NULL AS lot_number, NULL AS expiry_date,
               ii.stock_shortage AS quantity, NULL AS unit_cost, NULL AS total_cost,
               'venta' AS reason, pat.full_name AS patient_name, NULL AS session_id,
               inv.id AS invoice_id, NULL AS supplier_name, NULL AS registered_by
        FROM invoice_items ii
        JOIN invoices inv ON inv.id = ii.invoice_id
        JOIN products p   ON p.id   = ii.product_id
        JOIN patients pat ON pat.id = inv.patient_id
        WHERE ii.item_type = 'magistral' AND ii.stock_shortage > 0
          AND DATE(inv.created_at) BETWEEN ? AND ?
          ${product_id ? 'AND ii.product_id = ?' : ''}
        UNION ALL
        SELECT 'faltante', ss.performed_date,
               p.id, p.generic_name, p.commercial_name, p.consumption_unit,
               NULL, NULL,
               sp.quantity, NULL, NULL,
               'sesion', pat.full_name, ss.id,
               NULL, NULL, u.name
        FROM session_products sp
        JOIN sessions ss  ON ss.id  = sp.session_id
        JOIN patient_treatments pt ON pt.id = ss.patient_treatment_id
        JOIN patients pat ON pat.id = pt.patient_id
        JOIN products p   ON p.id   = sp.product_id
        LEFT JOIN users u ON u.id   = ss.attended_by
        WHERE sp.stock_entry_id IS NULL
          AND DATE(ss.performed_date) BETWEEN ? AND ?
          ${product_id ? 'AND sp.product_id = ?' : ''}
      `;
      const shortageParams = product_id
        ? [dateFrom, dateTo, product_id, dateFrom, dateTo, product_id]
        : [dateFrom, dateTo, dateFrom, dateTo];

      const [entries]   = await db.execute(entriesSQL, entryParams);
      const [exits]     = await db.execute(exitsSQL,   exitParams);
      let   [shortages] = await db.execute(shortageSQL, shortageParams);
      if (type === 'sesion' || type === 'venta') shortages = shortages.filter(m => m.reason === type);
      if (['entrada', 'vencimiento', 'ajuste'].includes(type)) shortages = [];

      let movements = [...entries, ...exits, ...shortages].sort((a, b) => new Date(b.mov_date) - new Date(a.mov_date));

      // Filtro por tipo general (entrada / salida / faltante)
      if (type === 'entrada')  movements = movements.filter(m => m.mov_type === 'entrada');
      if (type === 'salida')   movements = movements.filter(m => m.mov_type === 'salida');
      if (type === 'faltante') movements = movements.filter(m => m.mov_type === 'faltante');
      // Los filtros por motivo de salida no incluyen entradas
      if (['sesion', 'vencimiento', 'ajuste', 'venta'].includes(type)) movements = movements.filter(m => m.mov_type !== 'entrada');

      const [products] = await db.execute(
        'SELECT id, generic_name, commercial_name FROM products WHERE is_active = 1 ORDER BY generic_name'
      );

      res.render('inventory/movements', {
        title: 'Movimientos de Stock',
        movements, products,
        filters: { from: dateFrom, to: dateTo, product_id: product_id || '', type: type || '' }
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar movimientos.');
      res.redirect('/inventario');
    }
  }
};

module.exports = stockController;
