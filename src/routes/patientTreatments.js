const express = require('express');
const { body } = require('express-validator');
const ptController = require('../controllers/patientTreatmentController');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

const rules = [
  body('treatment_id').isInt({ min: 1 }).withMessage('Selecciona un tratamiento.'),
  body('payment_plan').isIn(['por_sesion', 'paquete']).withMessage('Plan de pago inválido.'),
  body('start_date').isDate().withMessage('La fecha de inicio es requerida.')
];

router.get('/pacientes/:patientId/tratamientos/nuevo', ptController.showCreate);
router.post('/pacientes/:patientId/tratamientos',      rules, ptController.create);
router.get('/planes/:id',                              ptController.show);

module.exports = router;
