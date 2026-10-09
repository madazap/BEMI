const { validationResult } = require('express-validator');
const Invoice          = require('../models/Invoice');
const Quotation        = require('../models/Quotation');
const Patient          = require('../models/Patient');
const PatientTreatment = require('../models/PatientTreatment');
const Product          = require('../models/Product');
const Treatment        = require('../models/Treatment');

const invoiceController = {

  async index(req, res) {
    try {
      const filters = {
        patientId:  req.query.patient_id || '',
        status:     ['con_saldo', ...Invoice.STATUSES].includes(req.query.status) ? req.query.status : '',
        from:       req.query.from    || '',
        to:         req.query.to      || '',
        minAgeDays: req.query.min_age || '',
        method:     Invoice.PAY_METHODS.includes(req.query.method) ? req.query.method : '',
        search:     req.query.search  || '',
        sort:       ['antiguas', 'saldo'].includes(req.query.sort) ? req.query.sort : 'recientes'
      };
      const [invoices, stats, selectedPatient] = await Promise.all([
        Invoice.findAll(filters),
        Invoice.statsByStatus(filters),
        filters.patientId ? Patient.findById(filters.patientId) : null
      ]);
      res.render('invoices/index', { title: 'Facturación', invoices, stats, filters, selectedPatient });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar facturas.');
      res.redirect('/dashboard');
    }
  },

  async showCreate(req, res) {
    try {
      const [treatments, magistrals] = await Promise.all([
        Treatment.findActive(),
        Product.findMagistralActive()
      ]);
      let preloaded  = null;

      if (req.query.quotation_id) {
        preloaded = await Quotation.findById(req.query.quotation_id);
        if (!preloaded || !['aprobada'].includes(preloaded.status)) {
          req.flash('error', preloaded?.status === 'facturada'
            ? 'Esta cotización ya fue facturada.'
            : 'Cotización no válida.');
          return res.redirect(`/cotizaciones/${req.query.quotation_id}`);
        }
        // Vista previa con las mismas líneas (incluidos descuentos) que tendrá la factura
        preloaded.invoiceLines = Invoice.linesFromQuotation(preloaded, preloaded.items);
      }

      res.render('invoices/form', {
        title: 'Nueva Factura',
        treatments,
        magistrals,
        preloaded,
        quotationId: req.query.quotation_id || null
      });
    } catch (err) {
      console.error(err);
      res.redirect('/facturas');
    }
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/facturas/nueva');
    }
    try {
      let result;
      if (req.body.quotation_id) {
        result = await Invoice.createFromQuotation(req.body.quotation_id, {
          patient_treatment_id: req.body.patient_treatment_id || null,
          created_by: req.session.userId
        });
        await Quotation.markAsBilled(req.body.quotation_id, result.id);
      } else {
        const items = parseItems(req.body);
        if (!items.length) {
          req.flash('error', 'Debes agregar al menos una línea.');
          return res.redirect('/facturas/nueva');
        }
        result = await Invoice.create({
          patient_id:          req.body.patient_id,
          patient_treatment_id: req.body.patient_treatment_id || null,
          items,
          created_by: req.session.userId
        });
      }
      if (result.warnings.length) {
        req.flash('error', `Factura creada, pero con magistrales sin stock suficiente: ${result.warnings.join(' | ')}. Registra la entrada en inventario.`);
      } else {
        req.flash('success', 'Factura creada.');
      }
      res.redirect(`/facturas/${result.id}`);
    } catch (err) {
      console.error(err);
      req.flash('error',
        err.code === 'NOT_MAGISTRAL'      ? 'El producto seleccionado no está marcado como magistral.' :
        'Error al crear la factura.');
      res.redirect(req.body.quotation_id ? `/facturas/nueva?quotation_id=${req.body.quotation_id}` : '/facturas/nueva');
    }
  },

  async show(req, res) {
    try {
      const invoiceData = await Invoice.findById(req.params.id);
      if (!invoiceData) return res.status(404).render('404', { title: 'No encontrado' });
      res.render('invoices/show', { title: `Factura #${invoiceData.id}`, invoiceData });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la factura.');
      res.redirect('/facturas');
    }
  },

  async addPayment(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/facturas/${req.params.id}`);
    }
    try {
      const { amount, method } = req.body;
      const invoiceData = await Invoice.findById(req.params.id);
      if (!invoiceData) return res.status(404).render('404', { title: 'No encontrado' });

      if (Number(amount) > invoiceData.totalPending + 0.01) {
        req.flash('error', 'El monto supera el saldo pendiente.');
        return res.redirect(`/facturas/${req.params.id}`);
      }

      await Invoice.addPayment({
        invoice_id:   req.params.id,
        amount,
        method,
        registered_by: req.session.userId
      });
      req.flash('success', 'Pago registrado correctamente.');
      res.redirect(`/facturas/${req.params.id}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al registrar el pago.');
      res.redirect(`/facturas/${req.params.id}`);
    }
  },

  async receivables(req, res) {
    try {
      const filters = {
        minAgeDays: req.query.min_age || '',
        search:     req.query.search  || '',
        sort:       req.query.sort === 'antiguedad' ? 'antiguedad' : 'deuda'
      };
      const { patients, summary } = await Invoice.findReceivables(filters);
      res.render('invoices/receivables', { title: 'Por Cobrar', patients, summary, filters });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el reporte de cuentas por cobrar.');
      res.redirect('/facturas');
    }
  },

  async receivablesCsv(req, res) {
    try {
      const filters = {
        minAgeDays: req.query.min_age || '',
        search:     req.query.search  || '',
        sort:       req.query.sort === 'antiguedad' ? 'antiguedad' : 'deuda'
      };
      const { patients } = await Invoice.findReceivables(filters);

      const esc = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
      const lines = [
        ['Paciente', 'Documento', 'Teléfono', 'Correo', 'Factura', 'Fecha', 'Tratamiento',
         'Total Factura', 'Pagado', 'Saldo Pendiente', 'Días'].join(',')
      ];
      patients.forEach(p => {
        p.invoices.forEach(inv => {
          lines.push([
            esc(p.patient_name),
            esc(p.document_number),
            esc(p.phone),
            esc(p.email),
            esc('#' + inv.id),
            esc(new Date(inv.created_at).toLocaleDateString('es-CO')),
            esc(inv.treatment_name || ''),
            inv.total_amount.toFixed(2),
            inv.total_paid.toFixed(2),
            inv.pending.toFixed(2),
            inv.days_old
          ].join(','));
        });
      });

      // BOM para que Excel reconozca UTF-8 (tildes, ñ) correctamente
      const csv = '﻿' + lines.join('\r\n');
      const fileDate = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cuentas_por_cobrar_${fileDate}.csv"`);
      res.send(csv);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al exportar el reporte.');
      res.redirect('/facturas/por-cobrar');
    }
  },

  async print(req, res) {
    try {
      const invoiceData = await Invoice.findById(req.params.id);
      if (!invoiceData) return res.status(404).send('No encontrado');
      res.render('invoices/print', { layout: false, invoiceData });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error al generar impresión.');
    }
  }
};

function parseItems(body) {
  const types  = toArray(body.item_type);
  const descs  = toArray(body.item_description);
  const qtys   = toArray(body.item_quantity);
  const prices = toArray(body.item_unit_price);
  const sIds   = toArray(body.item_session_id);
  const pIds   = toArray(body.item_product_id);

  return types.map((type, i) => ({
    item_type:   type,
    session_id:  sIds[i] || null,
    product_id:  pIds[i] || null,
    description: descs[i] || '',
    quantity:    parseFloat(qtys[i]) || 1,
    unit_price:  parseFloat(prices[i]) || 0
  })).filter(it => ['sesion', 'magistral'].includes(it.item_type) && it.description && it.unit_price > 0);
}

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

module.exports = invoiceController;
