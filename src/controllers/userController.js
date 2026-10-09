const { validationResult } = require('express-validator');
const User = require('../models/User');

const userController = {

  async index(req, res) {
    try {
      const users = await User.findAll();
      res.render('users/index', { title: 'Usuarios', users });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar usuarios.');
      res.redirect('/dashboard');
    }
  },

  async showCreate(req, res) {
    const roles = await User.getRoles();
    res.render('users/form', {
      title: 'Nuevo Usuario',
      user: null,
      roles,
      selectedRoles: []
    });
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/usuarios/nuevo');
    }

    const { name, email, password } = req.body;
    const roleIds = toArray(req.body.roles).map(Number);

    try {
      await User.create({ name, email, password, roleIds });
      req.flash('success', `Usuario "${name}" creado correctamente.`);
      res.redirect('/usuarios');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'El email ya está registrado.');
      } else {
        console.error(err);
        req.flash('error', 'Error al crear el usuario.');
      }
      res.redirect('/usuarios/nuevo');
    }
  },

  async showEdit(req, res) {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).render('404', { title: 'No encontrado' });
      const roles        = await User.getRoles();
      const selectedRoles = await User.getRoleIdsByUserId(user.id);
      res.render('users/form', { title: 'Editar Usuario', user, roles, selectedRoles });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el usuario.');
      res.redirect('/usuarios');
    }
  },

  async update(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/usuarios/${req.params.id}/editar`);
    }

    const { name, email, password } = req.body;
    const roleIds = toArray(req.body.roles).map(Number);

    try {
      await User.update(req.params.id, { name, email, password: password || null, roleIds });
      req.flash('success', 'Usuario actualizado correctamente.');
      res.redirect('/usuarios');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'El email ya está en uso por otro usuario.');
      } else {
        console.error(err);
        req.flash('error', 'Error al actualizar el usuario.');
      }
      res.redirect(`/usuarios/${req.params.id}/editar`);
    }
  },

  async toggleActive(req, res) {
    try {
      await User.toggleActive(req.params.id);
      req.flash('success', 'Estado del usuario actualizado.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cambiar el estado.');
    }
    res.redirect('/usuarios');
  },

  async disableTotp(req, res) {
    try {
      await User.disableTotp(req.params.id);
      req.flash('success', 'Verificación en dos pasos desactivada para este usuario.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al desactivar la verificación en dos pasos.');
    }
    res.redirect(`/usuarios/${req.params.id}/editar`);
  }
};

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

module.exports = userController;
