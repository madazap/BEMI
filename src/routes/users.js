const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireLogin, requireAdmin);

const createRules = [
  body('name').trim().notEmpty().withMessage('El nombre es requerido.'),
  body('email').isEmail().withMessage('Email inválido.').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres.')
];

const updateRules = [
  body('name').trim().notEmpty().withMessage('El nombre es requerido.'),
  body('email').isEmail().withMessage('Email inválido.').normalizeEmail(),
  body('password').optional({ checkFalsy: true })
    .isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres.')
];

router.get('/',                  userController.index);
router.get('/nuevo',             userController.showCreate);
router.post('/',                 createRules, userController.create);
router.get('/:id/editar',        userController.showEdit);
router.post('/:id',              updateRules, userController.update);
router.post('/:id/toggle-activo', userController.toggleActive);
router.post('/:id/2fa/desactivar', userController.disableTotp);

module.exports = router;
