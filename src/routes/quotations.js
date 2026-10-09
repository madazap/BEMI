const express = require('express');
const { body } = require('express-validator');
const quotationController = require('../controllers/quotationController');
const Treatment = require('../models/Treatment');
const Product   = require('../models/Product');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

const baseRules = [
  body('patient_id').notEmpty().withMessage('El paciente es requerido.')
];

// API endpoints para autofill de precios
router.get('/api/tratamientos/:id/precio', async (req, res) => {
  const t = await Treatment.findById(req.params.id);
  if (!t) return res.status(404).json({ error: 'No encontrado' });
  res.json({ name: t.name, sale_price: t.sale_price });
});

router.get('/api/magistrales/:id/precio', async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json({ name: p.generic_name, sale_price: p.sale_price });
});

router.get('/',             quotationController.index);
router.get('/nueva',        requireAdmin, quotationController.showCreate);
router.post('/',            requireAdmin, baseRules, quotationController.create);
router.get('/:id',          quotationController.show);
router.get('/:id/editar',   requireAdmin, quotationController.showEdit);
router.post('/:id',         requireAdmin, quotationController.update);
router.post('/:id/enviar',  quotationController.send);
router.post('/:id/aprobar', requireAdmin, quotationController.approve);
router.post('/:id/rechazar',quotationController.reject);
router.post('/:id/reabrir', quotationController.reopen);
router.get('/:id/imprimir', quotationController.print);

module.exports = router;
