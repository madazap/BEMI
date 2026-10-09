const { validationResult, body } = require('express-validator');
const ProfessionalRate = require('../models/ProfessionalRate');

const rateController = {

  async index(req, res) {
    try {
      const [current, all] = await Promise.all([
        ProfessionalRate.findCurrent(),
        ProfessionalRate.findAll()
      ]);
      res.render('rates/index', { title: 'Tarifas Profesional', current, all });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar tarifas.');
      res.redirect('/dashboard');
    }
  },

  showCreate(req, res) {
    const today = new Date().toISOString().split('T')[0];
    res.render('rates/form', { title: 'Nueva Tarifa', today });
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/tarifas/nueva');
    }
    try {
      await ProfessionalRate.create({
        service_type:   req.body.service_type,
        hourly_rate:    parseFloat(req.body.hourly_rate),
        effective_from: req.body.effective_from
      });
      req.flash('success', 'Tarifa registrada. La tarifa anterior del mismo tipo fue cerrada.');
      res.redirect('/tarifas');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al registrar la tarifa.');
      res.redirect('/tarifas/nueva');
    }
  }
};

module.exports = rateController;
