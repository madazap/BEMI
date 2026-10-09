const express = require('express');
const { body } = require('express-validator');
const profileController = require('../controllers/profileController');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

const tokenRules = [
  body('token').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Código inválido.')
];

const passwordRules = [
  body('password').notEmpty().withMessage('La contraseña es requerida.')
];

router.get('/2fa',            profileController.show2fa);
router.post('/2fa/generar',   profileController.generate2fa);
router.post('/2fa/confirmar', tokenRules,    profileController.confirm2fa);
router.post('/2fa/desactivar', passwordRules, profileController.disable2fa);

module.exports = router;
