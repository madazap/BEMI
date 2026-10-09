const { validationResult } = require('express-validator');
const Quotation    = require('../models/Quotation');
const Patient      = require('../models/Patient');
const Treatment    = require('../models/Treatment');
const Product      = require('../models/Product');

const quotationController = {

  async index(req, res) {
    try {
      const filters = {
        patientId:  req.query.patient_id || '',
        status:     req.query.status     || '',
        from:       req.query.from       || '',
        to:         req.query.to         || '',
        minAgeDays: req.query.min_age    || '',
        search:     req.query.search     || '',
        sort:       req.query.sort === 'antiguas' ? 'antiguas' : 'recientes'
      };
      const [quotations, stats, selectedPatient] = await Promise.all([
        Quotation.findAll(filters),
        Quotation.statsByStatus(filters),
        filters.patientId ? Patient.findById(filters.patientId) : null
      ]);
      res.render('quotations/index', {
        title: 'Cotizaciones',
        quotations, selectedPatient, stats, filters,
        patientId: filters.patientId
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar cotizaciones.');
      res.redirect('/dashboard');
    }
  },

  async showCreate(req, res) {
    try {
      const treatments = await Treatment.findActive();
      const magistrals = await Product.findMagistralActive();
      res.render('quotations/form', {
        title: 'Nueva Cotización',
        quotationData: null,
        treatments, magistrals
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el formulario.');
      res.redirect('/cotizaciones');
    }
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/cotizaciones/nueva');
    }
    try {
      const items = parseItems(req.body);
      if (!items.length) {
        req.flash('error', 'Debes agregar al menos una línea.');
        return res.redirect('/cotizaciones/nueva');
      }
      const id = await Quotation.create({
        patient_id:     req.body.patient_id,
        notes:          req.body.notes,
        discount_type:  req.body.discount_type || null,
        discount_value: req.body.discount_value || 0,
        items,
        created_by: req.session.userId
      });
      req.flash('success', 'Cotización creada.');
      res.redirect(`/cotizaciones/${id}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al crear la cotización.');
      res.redirect('/cotizaciones/nueva');
    }
  },

  async show(req, res) {
    try {
      const quotationData = await Quotation.findById(req.params.id);
      if (!quotationData) return res.status(404).render('404', { title: 'No encontrado' });
      res.render('quotations/show', { title: `Cotización #${quotationData.id}`, quotationData });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la cotización.');
      res.redirect('/cotizaciones');
    }
  },

  async showEdit(req, res) {
    try {
      const quotationData = await Quotation.findById(req.params.id);
      if (!quotationData) return res.status(404).render('404', { title: 'No encontrado' });
      if (quotationData.status !== 'borrador') {
        req.flash('error', 'Solo se pueden editar cotizaciones en borrador.');
        return res.redirect(`/cotizaciones/${req.params.id}`);
      }
      const treatments = await Treatment.findActive();
      const magistrals = await Product.findMagistralActive();
      res.render('quotations/form', {
        title: `Editar Cotización #${quotationData.id}`,
        quotationData, treatments, magistrals
      });
    } catch (err) {
      console.error(err);
      res.redirect('/cotizaciones');
    }
  },

  async update(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/cotizaciones/${req.params.id}/editar`);
    }
    try {
      const items = parseItems(req.body);
      if (!items.length) {
        req.flash('error', 'Debes agregar al menos una línea.');
        return res.redirect(`/cotizaciones/${req.params.id}/editar`);
      }
      await Quotation.update(req.params.id, {
        notes:          req.body.notes,
        discount_type:  req.body.discount_type || null,
        discount_value: req.body.discount_value || 0,
        items
      });
      req.flash('success', 'Cotización actualizada.');
      res.redirect(`/cotizaciones/${req.params.id}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al actualizar.');
      res.redirect(`/cotizaciones/${req.params.id}/editar`);
    }
  },

  async send(req, res) {
    const ok = await Quotation.transition(req.params.id, ['borrador'], 'enviada');
    req.flash(ok ? 'success' : 'error', ok ? 'Cotización enviada.' : 'Solo se pueden enviar cotizaciones en borrador.');
    res.redirect(`/cotizaciones/${req.params.id}`);
  },

  async approve(req, res) {
    try {
      const { plans, sessions } = await Quotation.approve(req.params.id, { created_by: req.session.userId });
      req.flash('success', plans
        ? `Cotización aprobada. Se crearon ${plans} plan${plans === 1 ? '' : 'es'} de tratamiento con ${sessions} sesion${sessions === 1 ? '' : 'es'} pendiente${sessions === 1 ? '' : 's'}.`
        : 'Cotización aprobada.');
    } catch (err) {
      if (err.code !== 'INVALID_STATUS') console.error(err);
      req.flash('error', err.code === 'INVALID_STATUS' ? err.message : 'Error al aprobar la cotización.');
    }
    res.redirect(`/cotizaciones/${req.params.id}`);
  },

  // Rechazar/reabrir solo antes de aprobar: una vez aprobada ya existen planes y sesiones.
  async reject(req, res) {
    const ok = await Quotation.transition(req.params.id, ['borrador', 'enviada'], 'rechazada');
    req.flash(ok ? 'success' : 'error', ok ? 'Cotización rechazada.' : 'Esta cotización ya no se puede rechazar.');
    res.redirect(`/cotizaciones/${req.params.id}`);
  },

  async reopen(req, res) {
    const ok = await Quotation.transition(req.params.id, ['enviada', 'rechazada'], 'borrador');
    req.flash(ok ? 'success' : 'error', ok ? 'Cotización reabierta para revisión.' : 'Esta cotización ya no se puede reabrir.');
    res.redirect(`/cotizaciones/${req.params.id}`);
  },

  async print(req, res) {
    try {
      const quotationData = await Quotation.findById(req.params.id);
      if (!quotationData) return res.status(404).send('No encontrado');
      res.render('quotations/print', { layout: false, quotationData });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error al generar impresión.');
    }
  }
};

function parseItems(body) {
  const types      = toArray(body.item_type);
  const tIds       = toArray(body.treatment_id);
  const pIds       = toArray(body.product_id);
  const descs      = toArray(body.item_description);
  const qtys       = toArray(body.item_quantity);
  const prices     = toArray(body.item_unit_price);
  const discTypes  = toArray(body.item_discount_type);
  const discVals   = toArray(body.item_discount_value);

  return types.map((type, i) => ({
    item_type:      type,
    treatment_id:   tIds[i] || null,
    product_id:     pIds[i] || null,
    description:    descs[i] || '',
    quantity:       parseFloat(qtys[i]) || 1,
    unit_price:     parseFloat(prices[i]) || 0,
    discount_type:  discTypes[i] || null,
    discount_value: parseFloat(discVals[i]) || 0
  })).filter(it => it.description && it.unit_price > 0);
}

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

module.exports = quotationController;
