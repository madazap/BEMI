const { validationResult } = require('express-validator');
const { verify: verifyTotp } = require('otplib');
const User = require('../models/User');

function completeLogin(req, res, user, roles) {
  req.session.regenerate((err) => {
    if (err) {
      req.flash('error', 'Error interno. Intenta de nuevo.');
      return res.redirect('/login');
    }
    delete req.session.pendingUserId;
    req.session.userId   = user.id;
    req.session.userName = user.name;
    req.session.roles    = roles;
    res.redirect('/dashboard');
  });
}

const authController = {

  showLogin(req, res) {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('auth/login', { layout: false, title: 'Iniciar Sesión' });
  },

  async login(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', 'Email o contraseña inválidos.');
      return res.redirect('/login');
    }

    const { email, password } = req.body;
    try {
      const user = await User.findByEmail(email);
      const valid = user && await User.verifyPassword(password, user.password_hash);

      if (!valid) {
        req.flash('error', 'Email o contraseña incorrectos.');
        return res.redirect('/login');
      }

      if (user.totp_enabled) {
        req.session.pendingUserId = user.id;
        return res.redirect('/login/2fa');
      }

      const roles = await User.getRolesByUserId(user.id);
      completeLogin(req, res, user, roles);
    } catch (err) {
      console.error('Login error:', err.message);
      req.flash('error', 'Error interno. Intenta de nuevo.');
      res.redirect('/login');
    }
  },

  showTotp(req, res) {
    if (!req.session.pendingUserId) return res.redirect('/login');
    res.render('auth/login-2fa', { layout: false, title: 'Verificación en dos pasos' });
  },

  async verifyTotp(req, res) {
    const pendingId = req.session.pendingUserId;
    if (!pendingId) return res.redirect('/login');

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', 'Ingresa el código de 6 dígitos.');
      return res.redirect('/login/2fa');
    }

    try {
      const user = await User.findByIdAuth(pendingId);
      const result = user && user.totp_enabled &&
        await verifyTotp({ secret: user.totp_secret, token: req.body.token });

      if (!result || !result.valid) {
        req.flash('error', 'Código incorrecto o expirado.');
        return res.redirect('/login/2fa');
      }

      const roles = await User.getRolesByUserId(user.id);
      completeLogin(req, res, user, roles);
    } catch (err) {
      console.error('2FA verify error:', err.message);
      req.flash('error', 'Error interno. Intenta de nuevo.');
      res.redirect('/login/2fa');
    }
  },

  logout(req, res) {
    req.session.destroy(() => {
      res.clearCookie('sid');
      res.redirect('/login');
    });
  }
};

module.exports = authController;
