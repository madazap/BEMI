const express = require('express');
const { body } = require('express-validator');
const patientController = require('../controllers/patientController');
const Patient = require('../models/Patient');
const MagistralRenewal = require('../models/MagistralRenewal');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

const rules = [
  body('document_type').notEmpty().withMessage('El tipo de documento es requerido.'),
  body('document_number').trim().notEmpty().withMessage('El número de documento es requerido.'),
  body('full_name').trim().notEmpty().withMessage('El nombre completo es requerido.')
];

// Búsqueda para el selector de pacientes (cédula, nombre, celular o email)
router.get('/api/buscar', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    res.json(await Patient.search(q, 20));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en la búsqueda' });
  }
});

router.get('/',             patientController.index);
router.get('/nuevo',        patientController.showCreate);
router.post('/',            rules, patientController.create);
router.get('/:id',          patientController.show);

// Alerta de renovación de magistrales: marcar "No renovar" o reactivar
router.post('/:id/magistrales/:productId/no-renovar', async (req, res) => {
  await MagistralRenewal.dismiss(req.params.id, req.params.productId, req.session.userId);
  req.flash('success', 'Alerta de renovación desactivada para este magistral. Se reactivará si el paciente vuelve a comprarlo.');
  res.redirect(`/pacientes/${req.params.id}#magistrales`);
});
router.post('/:id/magistrales/:productId/reactivar', async (req, res) => {
  await MagistralRenewal.reactivate(req.params.id, req.params.productId);
  req.flash('success', 'Alerta de renovación reactivada.');
  res.redirect(`/pacientes/${req.params.id}#magistrales`);
});
router.get('/:id/editar',   patientController.showEdit);
router.post('/:id',         rules, patientController.update);

module.exports = router;
