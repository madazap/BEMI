const express = require('express');
const { body } = require('express-validator');
const productController = require('../controllers/productController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin, requireAdmin);

const rules = [
  body('sku').trim().notEmpty().withMessage('El SKU es requerido.'),
  body('generic_name').trim().notEmpty().withMessage('El nombre genérico es requerido.'),
  body('purchase_unit').trim().notEmpty().withMessage('La unidad de compra es requerida.'),
  body('consumption_unit').trim().notEmpty().withMessage('La unidad de consumo es requerida.'),
  body('conversion_factor').isFloat({ min: 0.0001 }).withMessage('El factor de conversión debe ser mayor a 0.'),
  body('min_stock').isFloat({ min: 0 }).withMessage('El stock mínimo debe ser 0 o mayor.'),
  body('expiry_alert_days').isInt({ min: 1 }).withMessage('Los días de alerta deben ser al menos 1.')
];

router.get('/',                   productController.index);
router.get('/nuevo',              productController.showCreate);
router.post('/',                  rules, productController.create);
router.get('/:id/editar',         productController.showEdit);
router.post('/:id',               rules, productController.update);
router.post('/:id/toggle-activo', productController.toggleActive);

module.exports = router;
