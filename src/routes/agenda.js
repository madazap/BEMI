const express = require('express');
const { body } = require('express-validator');
const appointmentController = require('../controllers/appointmentController');
const Notification = require('../models/Notification');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

const rules = [
  body('professional_id').isInt({ min: 1 }).withMessage('Selecciona un profesional.'),
  body('scheduled_at').notEmpty().withMessage('La fecha y hora son requeridas.'),
  body('duration_minutes').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Duración inválida.')
];

router.get('/agenda',              appointmentController.index);
router.get('/agenda/:id',          appointmentController.show);
router.get('/agenda/:id/editar',   appointmentController.showEdit);
router.post('/agenda/:id',         rules, appointmentController.update);
router.post('/agenda/:id/confirmar', appointmentController.confirm);
router.post('/agenda/:id/realizar',  appointmentController.markDone);
router.post('/agenda/:id/cancelar',  appointmentController.cancel);

router.get('/api/agenda/eventos', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.json([]);
    const Appointment = require('../models/Appointment');
    const events = await Appointment.findForCalendar({ start, end });
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

router.get('/api/notificaciones', async (req, res) => {
  try {
    const counts = await Notification.getCounts();
    res.json(counts);
  } catch (err) {
    console.error(err);
    res.json({ lowStock: 0, expiringLots: 0, magistralRenewals: 0 });
  }
});

module.exports = router;
