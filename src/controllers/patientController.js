const { validationResult } = require('express-validator');
const Patient      = require('../models/Patient');
const PatientTreatment = require('../models/PatientTreatment');
const MagistralRenewal = require('../models/MagistralRenewal');

const patientController = {

  async index(req, res) {
    try {
      const filters = {
        segment:       Patient.SEGMENTS.includes(req.query.segment) ? req.query.segment : '',
        q:             (req.query.q || '').trim(),
        treatmentType: Patient.TREATMENT_TYPES.includes(req.query.type) ? req.query.type : '',
        from:          req.query.from || '',
        to:            req.query.to   || '',
        sort:          ['recientes', 'antiguos', 'saldo'].includes(req.query.sort) ? req.query.sort : 'nombre'
      };
      const [patients, stats] = await Promise.all([
        Patient.findAll(filters),
        Patient.statsBySegment(filters)
      ]);
      res.render('patients/index', { title: 'Pacientes', patients, stats, filters });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar pacientes.');
      res.redirect('/dashboard');
    }
  },

  showCreate(req, res) {
    res.render('patients/form', { title: 'Nuevo Paciente', patient: null });
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/pacientes/nuevo');
    }
    try {
      const id = await Patient.create(req.body);
      req.flash('success', 'Paciente registrado correctamente.');
      res.redirect(`/pacientes/${id}`);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'Ya existe un paciente con ese número de documento.');
      } else {
        console.error(err);
        req.flash('error', 'Error al registrar el paciente.');
      }
      res.redirect('/pacientes/nuevo');
    }
  },

  async show(req, res) {
    try {
      const patient = await Patient.findById(req.params.id);
      if (!patient) return res.status(404).render('404', { title: 'No encontrado' });
      const [treatments, magistrals] = await Promise.all([
        PatientTreatment.findByPatient(patient.id),
        MagistralRenewal.forPatient(patient.id)
      ]);
      res.render('patients/show', {
        title: patient.full_name, patient, treatments, magistrals,
        daysPerUnit: MagistralRenewal.DAYS_PER_UNIT, alertDays: MagistralRenewal.ALERT_DAYS
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el paciente.');
      res.redirect('/pacientes');
    }
  },

  async showEdit(req, res) {
    try {
      const patient = await Patient.findById(req.params.id);
      if (!patient) return res.status(404).render('404', { title: 'No encontrado' });
      res.render('patients/form', { title: 'Editar Paciente', patient });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el paciente.');
      res.redirect('/pacientes');
    }
  },

  async update(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/pacientes/${req.params.id}/editar`);
    }
    try {
      await Patient.update(req.params.id, req.body);
      req.flash('success', 'Paciente actualizado correctamente.');
      res.redirect(`/pacientes/${req.params.id}`);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'Ya existe un paciente con ese número de documento.');
      } else {
        console.error(err);
        req.flash('error', 'Error al actualizar el paciente.');
      }
      res.redirect(`/pacientes/${req.params.id}/editar`);
    }
  }
};

module.exports = patientController;
