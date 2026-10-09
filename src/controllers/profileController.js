const { validationResult } = require('express-validator');
const { generateSecret, generateURI, verify: verifyTotp } = require('otplib');
const qrcode = require('qrcode');
const User = require('../models/User');

const profileController = {

  async show2fa(req, res) {
    try {
      const user = await User.findByIdAuth(req.session.userId);
      res.render('auth/profile-2fa', {
        title: 'Verificación en dos pasos',
        enabled: !!user.totp_enabled,
        qrDataUrl: null,
        secret: null
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar la configuración.');
      res.redirect('/dashboard');
    }
  },

  async generate2fa(req, res) {
    try {
      const user = await User.findByIdAuth(req.session.userId);
      if (user.totp_enabled) {
        req.flash('error', 'Ya tienes la verificación en dos pasos activada.');
        return res.redirect('/mi-cuenta/2fa');
      }

      const secret  = generateSecret();
      req.session.pendingTotpSecret = secret;

      const otpauth   = generateURI({ issuer: 'BEMI', label: user.email, secret });
      const qrDataUrl = await qrcode.toDataURL(otpauth);

      res.render('auth/profile-2fa', {
        title: 'Verificación en dos pasos',
        enabled: false,
        qrDataUrl,
        secret
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al generar el código QR.');
      res.redirect('/mi-cuenta/2fa');
    }
  },

  async confirm2fa(req, res) {
    const errors = validationResult(req);
    const pendingSecret = req.session.pendingTotpSecret;

    if (!errors.isEmpty() || !pendingSecret) {
      req.flash('error', 'Código inválido. Genera el QR de nuevo e intenta otra vez.');
      return res.redirect('/mi-cuenta/2fa');
    }

    try {
      const result = await verifyTotp({ secret: pendingSecret, token: req.body.token });
      if (!result.valid) {
        req.flash('error', 'El código no coincide. Verifica la hora de tu dispositivo e intenta de nuevo.');
        return res.redirect('/mi-cuenta/2fa');
      }

      await User.setTotp(req.session.userId, pendingSecret);
      delete req.session.pendingTotpSecret;
      req.flash('success', 'Verificación en dos pasos activada correctamente.');
      res.redirect('/mi-cuenta/2fa');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al activar la verificación en dos pasos.');
      res.redirect('/mi-cuenta/2fa');
    }
  },

  async disable2fa(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', 'Debes ingresar tu contraseña actual.');
      return res.redirect('/mi-cuenta/2fa');
    }

    try {
      const user  = await User.findByIdAuth(req.session.userId);
      const valid = user && await User.verifyPassword(req.body.password, user.password_hash);
      if (!valid) {
        req.flash('error', 'Contraseña incorrecta.');
        return res.redirect('/mi-cuenta/2fa');
      }

      await User.disableTotp(user.id);
      req.flash('success', 'Verificación en dos pasos desactivada.');
      res.redirect('/mi-cuenta/2fa');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al desactivar la verificación en dos pasos.');
      res.redirect('/mi-cuenta/2fa');
    }
  }
};

module.exports = profileController;
