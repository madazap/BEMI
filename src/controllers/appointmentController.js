const { validationResult } = require('express-validator');
const Appointment  = require('../models/Appointment');
const User         = require('../models/User');
const Notification = require('../models/Notification');

const appointmentController = {

  async index(req, res) {
    try {
      const upcoming = await Appointment.findUpcoming(5);
      res.render('agenda/index', { title: 'Agenda', upcoming });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la agenda.');
      res.redirect('/dashboard');
    }
  },

  async api(req, res) {
    try {
      const { start, end } = req.query;
      if (!start || !end) return res.json([]);
      const events = await Appointment.findForCalendar({ start, end });
      res.json(events);
    } catch (err) {
      console.error(err);
      res.status(500).json([]);
    }
  },

  async show(req, res) {
    try {
      const appointmentData = await Appointment.findById(req.params.id);
      if (!appointmentData) return res.status(404).render('404', { title: 'No encontrado' });
      res.render('agenda/show', { title: 'Detalle de Cita', appointmentData });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la cita.');
      res.redirect('/agenda');
    }
  },

  async showEdit(req, res) {
    try {
      const appointmentData = await Appointment.findById(req.params.id);
      if (!appointmentData) return res.status(404).render('404', { title: 'No encontrado' });
      const professionals = await User.findAllActive();
      res.render('agenda/form', {
        title: 'Editar Cita',
        appointmentData,
        professionals
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la cita.');
      res.redirect('/agenda');
    }
  },

  async update(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/agenda/${req.params.id}/editar`);
    }
    const { professional_id, scheduled_at, duration_minutes, notes } = req.body;
    try {
      const conflict = await Appointment.findConflict({
        professional_id,
        scheduled_at,
        duration_minutes: duration_minutes || 60,
        excludeId: req.params.id
      });
      if (conflict) {
        req.flash('error', `Ese profesional ya tiene una cita con ${conflict.patient_name} el ${formatDateTime(conflict.scheduled_at)}. Elige otro horario.`);
        return res.redirect(`/agenda/${req.params.id}/editar`);
      }

      await Appointment.update(req.params.id, {
        professional_id, scheduled_at,
        duration_minutes: duration_minutes || 60, notes
      });
      req.flash('success', 'Cita actualizada correctamente.');
      res.redirect(`/agenda/${req.params.id}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al actualizar la cita.');
      res.redirect(`/agenda/${req.params.id}/editar`);
    }
  },

  async confirm(req, res) {
    try {
      await Appointment.updateStatus(req.params.id, 'confirmada');
      req.flash('success', 'Cita confirmada.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al confirmar la cita.');
    }
    res.redirect(`/agenda/${req.params.id}`);
  },

  async markDone(req, res) {
    try {
      await Appointment.updateStatus(req.params.id, 'realizada');
      req.flash('success', 'Cita marcada como realizada.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al actualizar la cita.');
    }
    res.redirect(`/agenda/${req.params.id}`);
  },

  async cancel(req, res) {
    try {
      await Appointment.updateStatus(req.params.id, 'cancelada');
      req.flash('success', 'Cita cancelada.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cancelar la cita.');
    }
    res.redirect(`/agenda/${req.params.id}`);
  }
};

function formatDateTime(date) {
  return new Date(date).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

module.exports = appointmentController;
