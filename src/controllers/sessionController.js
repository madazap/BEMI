const { validationResult } = require('express-validator');
const Session      = require('../models/Session');
const TreatmentProduct = require('../models/TreatmentProduct');
const Product      = require('../models/Product');
const Appointment  = require('../models/Appointment');

const sessionController = {

  async show(req, res) {
    try {
      const sessionData = await Session.findById(req.params.id);
      if (!sessionData) return res.status(404).render('404', { title: 'No encontrado' });
      const products = await Session.getProductsConsumed(sessionData.id);
      const snapshot = await Session.getSnapshot(sessionData.id);
      res.render('sessions/show', {
        title: `${Session.label(sessionData)} — ${sessionData.patient_name}`,
        sessionData,
        products,
        snapshot
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la sesión.');
      res.redirect('/pacientes');
    }
  },

  async showSchedule(req, res) {
    try {
      const sessionData = await Session.findById(req.params.id);
      if (!sessionData) return res.status(404).render('404', { title: 'No encontrado' });
      res.render('sessions/schedule', {
        title: `Agendar ${Session.label(sessionData)}`,
        sessionData
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la sesión.');
      res.redirect('/pacientes');
    }
  },

  async schedule(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/sesiones/${req.params.id}/agendar`);
    }
    try {
      const sessionId = req.params.id;
      const userId    = req.session.userId;
      const existing  = await Appointment.findBySessionId(sessionId);

      const conflict = await Appointment.findConflict({
        professional_id:  userId,
        scheduled_at:     req.body.scheduled_date,
        duration_minutes: 60,
        excludeId:        existing ? existing.id : null
      });
      if (conflict) {
        req.flash('error', `Ya tienes una cita agendada con ${conflict.patient_name} el ${formatDateTime(conflict.scheduled_at)}. Elige otro horario.`);
        return res.redirect(`/sesiones/${sessionId}/agendar`);
      }

      await Session.schedule(sessionId, { scheduled_date: req.body.scheduled_date });
      const sessionData = await Session.findById(sessionId);

      if (existing) {
        await Appointment.update(existing.id, {
          professional_id:  userId,
          scheduled_at:     req.body.scheduled_date,
          duration_minutes: 60,
          notes:            `${Session.label(sessionData)} — ${sessionData.treatment_name}`
        });
      } else {
        await Appointment.create({
          patient_id:       sessionData.patient_id,
          session_id:       sessionData.id,
          professional_id:  userId,
          scheduled_at:     req.body.scheduled_date,
          duration_minutes: 60,
          notes:            `${Session.label(sessionData)} — ${sessionData.treatment_name}`,
          created_by:       userId
        });
      }

      req.flash('success', 'Sesión agendada y visible en el calendario.');
      res.redirect(`/planes/${sessionData.patient_treatment_id}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al agendar la sesión.');
      res.redirect(`/sesiones/${req.params.id}/agendar`);
    }
  },

  async showPerform(req, res) {
    try {
      const sessionData = await Session.findById(req.params.id);
      if (!sessionData) return res.status(404).render('404', { title: 'No encontrado' });
      if (sessionData.status !== 'pendiente') {
        req.flash('error', 'Esta sesión ya fue realizada o cancelada.');
        return res.redirect(`/sesiones/${sessionData.id}`);
      }
      const [standard, products] = await Promise.all([
        // El control arranca sin insumos precargados; solo se registran adicionales
        sessionData.is_control ? [] : TreatmentProduct.findByTreatment(sessionData.treatment_id),
        Product.findConsumablesWithStock()
      ]);
      const now = new Date().toISOString().slice(0, 16);
      res.render('sessions/perform', {
        title: `Realizar ${Session.label(sessionData)}`,
        sessionData,
        standard,
        products,
        now
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la sesión.');
      res.redirect('/pacientes');
    }
  },

  async perform(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/sesiones/${req.params.id}/realizar`);
    }

    const { performed_date, professional_hours, notes } = req.body;
    const productIds = toArray(req.body.product_id);
    const quantities = toArray(req.body.quantity);
    const extras     = toArray(req.body.is_extra);

    const products = productIds
      .map((pid, i) => ({
        product_id: Number(pid),
        quantity:   parseFloat(quantities[i]),
        is_extra:   extras[i] === '1'
      }))
      .filter(p => p.product_id && p.quantity > 0);

    try {
      const warnings = await Session.perform(req.params.id, {
        performed_date,
        professional_hours: professional_hours || null,
        notes:              notes || null,
        attended_by:        req.session.userId,
        products
      });
      if (warnings.length) {
        req.flash('error', `Sesión registrada, pero con stock insuficiente en: ${warnings.join(' | ')}. Revisa el inventario.`);
      } else {
        req.flash('success', 'Sesión registrada y consumo de insumos aplicado.');
      }
      res.redirect(`/sesiones/${req.params.id}`);
    } catch (err) {
      if (err.code === 'INVALID_STATUS' || err.code === 'NOT_FOUND') {
        req.flash('error', err.message);
        return res.redirect(`/sesiones/${req.params.id}`);
      }
      console.error(err);
      req.flash('error', 'Error al registrar la sesión.');
      res.redirect(`/sesiones/${req.params.id}/realizar`);
    }
  },

  async cancel(req, res) {
    try {
      const sessionData = await Session.findById(req.params.id);
      await Session.cancel(req.params.id);
      req.flash('success', 'Sesión cancelada.');
      res.redirect(`/planes/${sessionData.patient_treatment_id}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cancelar la sesión.');
      res.redirect('/pacientes');
    }
  }
};

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function formatDateTime(date) {
  return new Date(date).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

module.exports = sessionController;
