const { validationResult } = require('express-validator');
const Treatment = require('../models/Treatment');

const treatmentController = {

  async index(req, res) {
    try {
      const filters = {
        segment: Treatment.SEGMENTS.includes(req.query.segment) ? req.query.segment : '',
        type:    Treatment.TYPES.includes(req.query.type) ? req.query.type : '',
        search:  (req.query.search || '').trim(),
        sort:    ['nombre', 'margen_desc', 'margen_asc', 'mas_vendidos'].includes(req.query.sort) ? req.query.sort : 'tipo'
      };
      const [treatments, stats] = await Promise.all([
        Treatment.findAll(filters),
        Treatment.statsBySegment(filters)
      ]);
      res.render('treatments/index', {
        title: 'Tratamientos', treatments, stats, filters, lowMarginPct: Treatment.LOW_MARGIN_PCT
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar tratamientos.');
      res.redirect('/dashboard');
    }
  },

  showCreate(req, res) {
    res.render('treatments/form', { title: 'Nuevo Tratamiento', treatment: null });
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/tratamientos/nuevo');
    }
    try {
      await Treatment.create(req.body);
      req.flash('success', 'Tratamiento creado correctamente.');
      res.redirect('/tratamientos');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al crear el tratamiento.');
      res.redirect('/tratamientos/nuevo');
    }
  },

  async showEdit(req, res) {
    try {
      const treatment = await Treatment.findById(req.params.id);
      if (!treatment) return res.status(404).render('404', { title: 'No encontrado' });
      res.render('treatments/form', { title: 'Editar Tratamiento', treatment });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el tratamiento.');
      res.redirect('/tratamientos');
    }
  },

  async update(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/tratamientos/${req.params.id}/editar`);
    }
    try {
      await Treatment.update(req.params.id, req.body);
      req.flash('success', 'Tratamiento actualizado correctamente.');
      res.redirect('/tratamientos');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al actualizar el tratamiento.');
      res.redirect(`/tratamientos/${req.params.id}/editar`);
    }
  },

  async toggleActive(req, res) {
    try {
      await Treatment.toggleActive(req.params.id);
      req.flash('success', 'Estado del tratamiento actualizado.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cambiar el estado.');
    }
    res.redirect('/tratamientos');
  }
};

module.exports = treatmentController;
