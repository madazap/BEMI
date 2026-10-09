const express = require('express');
const { body } = require('express-validator');
const invoiceController = require('../controllers/invoiceController');
const PatientTreatment  = require('../models/PatientTreatment');
const { requireLogin }  = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

const paymentRules = [
  body('amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a 0.'),
  body('method').isIn(['efectivo','transferencia','datafono']).withMessage('Método inválido.')
];

// API para planes del paciente
router.get('/api/pacientes/:id/planes', async (req, res) => {
  const plans = await PatientTreatment.findActiveByPatient(req.params.id);
  res.json(plans);
});

router.get('/',              invoiceController.index);
router.get('/nueva',         invoiceController.showCreate);
router.post('/',             invoiceController.create);
// Debe ir antes de '/:id' para que "por-cobrar" no se interprete como un id de factura.
router.get('/por-cobrar',     invoiceController.receivables);
router.get('/por-cobrar.csv', invoiceController.receivablesCsv);
router.get('/:id',           invoiceController.show);
router.post('/:id/pagos',    paymentRules, invoiceController.addPayment);
router.get('/:id/imprimir',  invoiceController.print);

module.exports = router;
