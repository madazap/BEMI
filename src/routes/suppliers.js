const express = require('express');
const { body } = require('express-validator');
const supplierController = require('../controllers/supplierController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin, requireAdmin);

const rules = [
  body('name').trim().notEmpty().withMessage('El nombre es requerido.')
];

router.get('/',                  supplierController.index);
router.get('/nuevo',             supplierController.showCreate);
router.post('/',                 rules, supplierController.create);
router.get('/:id/editar',        supplierController.showEdit);
router.post('/:id',              rules, supplierController.update);
router.post('/:id/toggle-activo', supplierController.toggleActive);

module.exports = router;
