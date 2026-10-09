const express = require('express');
const { body } = require('express-validator');
const stockController   = require('../controllers/stockController');
const productController = require('../controllers/productController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const entryRules = [
  body('product_id').isInt({ min: 1 }).withMessage('Selecciona un producto.'),
  body('purchase_quantity').isFloat({ min: 0.0001 }).withMessage('La cantidad debe ser mayor a 0.'),
  body('purchase_price').isFloat({ min: 0 }).withMessage('El precio debe ser 0 o mayor.'),
  body('entry_date').isDate().withMessage('Fecha de ingreso inválida.')
];

const exitRules = [
  body('product_id').isInt({ min: 1 }).withMessage('Selecciona un producto.'),
  body('stock_entry_id').isInt({ min: 1 }).withMessage('Selecciona un lote.'),
  body('quantity').isFloat({ min: 0.0001 }).withMessage('La cantidad debe ser mayor a 0.'),
  body('reason').isIn(['vencimiento', 'ajuste']).withMessage('Razón inválida.'),
  body('exit_date').isDate().withMessage('Fecha inválida.')
];

router.get('/inventario',                    requireLogin, stockController.index);
router.get('/inventario/movimientos',        requireLogin, requireAdmin, stockController.movements);
router.get('/inventario/ingresos/nuevo',     requireLogin, requireAdmin, stockController.showEntry);
router.post('/inventario/ingresos',          requireLogin, requireAdmin, entryRules, stockController.createEntry);
router.get('/inventario/producto/:id/lotes', requireLogin, stockController.showEntriesByProduct);
router.get('/inventario/salidas/nuevo',      requireLogin, requireAdmin, stockController.showExitForm);
router.post('/inventario/salidas',           requireLogin, requireAdmin, exitRules, stockController.createExit);

router.get('/api/productos/:id', requireLogin, productController.api);
router.get('/api/productos/:id/lotes', requireLogin, stockController.apiLotsByProduct);

module.exports = router;
