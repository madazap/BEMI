const express = require('express');
const { body } = require('express-validator');
const sessionController = require('../controllers/sessionController');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/:id',               sessionController.show);
router.get('/:id/agendar',       sessionController.showSchedule);
router.post('/:id/agendar',
  body('scheduled_date').notEmpty().withMessage('La fecha es requerida.'),
  sessionController.schedule
);
router.get('/:id/realizar',      sessionController.showPerform);
router.post('/:id/realizar',
  body('performed_date').notEmpty().withMessage('La fecha de realización es requerida.'),
  sessionController.perform
);
router.post('/:id/cancelar',     sessionController.cancel);

module.exports = router;
