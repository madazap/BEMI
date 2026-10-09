const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const authController = require('../controllers/authController');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Demasiados intentos. Espera 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false
});

const totpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Demasiados intentos. Espera 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/login',  authController.showLogin);
router.post('/login', loginLimiter,
  body('email').isEmail().withMessage('Email inválido.').normalizeEmail(),
  body('password').notEmpty().withMessage('La contraseña es requerida.'),
  authController.login
);

router.get('/login/2fa',  authController.showTotp);
router.post('/login/2fa', totpLimiter,
  body('token').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Código inválido.'),
  authController.verifyTotp
);

router.post('/logout', authController.logout);

module.exports = router;
