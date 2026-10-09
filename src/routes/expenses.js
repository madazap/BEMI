const express            = require('express');
const expenseController  = require('../controllers/expenseController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireLogin, requireAdmin);

router.get('/',                        expenseController.index);
router.post('/guardar',                expenseController.saveMonth);
router.post('/ocasionales',            expenseController.createOccasional);
router.post('/ocasionales/:id/eliminar', expenseController.deleteOccasional);
router.get('/informe',                 expenseController.report);
router.get('/categorias',              expenseController.categories);
router.post('/categorias',             expenseController.createCategory);
router.post('/categorias/:id/toggle',  expenseController.toggleCategory);

module.exports = router;
