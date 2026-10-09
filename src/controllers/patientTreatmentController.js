const { validationResult } = require('express-validator');
const PatientTreatment = require('../models/PatientTreatment');
const Patient          = require('../models/Patient');
const Treatment        = require('../models/Treatment');
const Session          = require('../models/Session');

const patientTreatmentController = {

  async showCreate(req, res) {
    try {
      const patient    = await Patient.findById(req.params.patientId);
      if (!patient) return res.status(404).render('404', { title: 'No encontrado' });
      const treatments = await Treatment.findActive();
      res.render('patient-treatments/form', {
        title: 'Asignar Tratamiento',
        patient,
        treatments
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el formulario.');
      res.redirect(`/pacientes/${req.params.patientId}`);
    }
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/pacientes/${req.params.patientId}/tratamientos/nuevo`);
    }
    try {
      const ptId = await PatientTreatment.create({
        patient_id:   req.params.patientId,
        treatment_id: req.body.treatment_id,
        payment_plan: req.body.payment_plan,
        start_date:   req.body.start_date,
        created_by:   req.session.userId
      });
      req.flash('success', 'Tratamiento asignado y sesiones creadas.');
      res.redirect(`/planes/${ptId}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al asignar el tratamiento.');
      res.redirect(`/pacientes/${req.params.patientId}/tratamientos/nuevo`);
    }
  },

  async show(req, res) {
    try {
      const pt = await PatientTreatment.findById(req.params.id);
      if (!pt) return res.status(404).render('404', { title: 'No encontrado' });
      const sessions = await Session.findByPatientTreatment(pt.id);
      res.render('patient-treatments/show', {
        title: `Plan: ${pt.treatment_name}`,
        pt,
        sessions
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el plan.');
      res.redirect('/pacientes');
    }
  }
};

module.exports = patientTreatmentController;
