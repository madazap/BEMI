const express          = require('express');
const { body }         = require('express-validator');
const { TREATMENT_TYPES } = require('../config/constants');
const rateController   = require('../controllers/rateController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireLogin, requireAdmin);

const createRules = [
  body('service_type').isIn(Object.keys(TREATMENT_TYPES)).withMessage('Tipo de servicio inválido.'),
  body('hourly_rate').isFloat({ min: 0 }).withMessage('La tarifa debe ser un número positivo.'),
  body('effective_from').isDate().withMessage('Fecha inválida.')
];

router.get('/',        rateController.index);
router.get('/nueva',   rateController.showCreate);
router.post('/',       createRules, rateController.create);

module.exports = router;
