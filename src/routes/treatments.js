const express = require('express');
const { TREATMENT_TYPES } = require('../config/constants');
const { body } = require('express-validator');
const treatmentController = require('../controllers/treatmentController');
const TreatmentProduct    = require('../models/TreatmentProduct');
const Product             = require('../models/Product');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin, requireAdmin);

const rules = [
  body('name').trim().notEmpty().withMessage('El nombre es requerido.'),
  body('type').isIn(Object.keys(TREATMENT_TYPES)).withMessage('Tipo inválido.'),
  body('total_sessions').isInt({ min: 1 }).withMessage('Las sesiones deben ser al menos 1.'),
  body('sale_price').isFloat({ min: 0 }).withMessage('El precio de venta es requerido.'),
  body('execution_cost').isFloat({ min: 0 }).withMessage('El costo de ejecución es requerido.')
];

router.get('/',              treatmentController.index);
router.get('/nuevo',         treatmentController.showCreate);
router.post('/',             rules, treatmentController.create);
router.get('/:id/editar',    treatmentController.showEdit);
router.post('/:id',          rules, treatmentController.update);
router.post('/:id/toggle',   treatmentController.toggleActive);

// API: insumos por tratamiento
router.get('/:id/insumos', async (req, res) => {
  try {
    const products = await TreatmentProduct.findByTreatment(req.params.id);
    const allProducts = await Product.findActive();
    res.json({ products, allProducts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/:id/insumos', async (req, res) => {
  try {
    const ids  = Array.isArray(req.body.product_id) ? req.body.product_id : (req.body.product_id ? [req.body.product_id] : []);
    const qtys = Array.isArray(req.body.quantity)   ? req.body.quantity   : (req.body.quantity   ? [req.body.quantity]   : []);
    const entries = ids.map((id, i) => ({ product_id: id, quantity: qtys[i] })).filter(e => e.product_id);
    await TreatmentProduct.set(req.params.id, entries);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar' });
  }
});

module.exports = router;
