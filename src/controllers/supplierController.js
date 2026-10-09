const { validationResult } = require('express-validator');
const Supplier = require('../models/Supplier');

const supplierController = {

  async index(req, res) {
    try {
      const suppliers = await Supplier.findAll();
      res.render('suppliers/index', { title: 'Proveedores', suppliers });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar proveedores.');
      res.redirect('/dashboard');
    }
  },

  async showCreate(req, res) {
    res.render('suppliers/form', { title: 'Nuevo Proveedor', supplier: null });
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/proveedores/nuevo');
    }
    const { name, contact_name, phone, email } = req.body;
    try {
      await Supplier.create({ name, contact_name, phone, email });
      req.flash('success', `Proveedor "${name}" creado correctamente.`);
      res.redirect('/proveedores');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al crear el proveedor.');
      res.redirect('/proveedores/nuevo');
    }
  },

  async showEdit(req, res) {
    try {
      const supplier = await Supplier.findById(req.params.id);
      if (!supplier) return res.status(404).render('404', { title: 'No encontrado' });
      res.render('suppliers/form', { title: 'Editar Proveedor', supplier });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el proveedor.');
      res.redirect('/proveedores');
    }
  },

  async update(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/proveedores/${req.params.id}/editar`);
    }
    const { name, contact_name, phone, email } = req.body;
    try {
      await Supplier.update(req.params.id, { name, contact_name, phone, email });
      req.flash('success', 'Proveedor actualizado correctamente.');
      res.redirect('/proveedores');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al actualizar el proveedor.');
      res.redirect(`/proveedores/${req.params.id}/editar`);
    }
  },

  async toggleActive(req, res) {
    try {
      await Supplier.toggleActive(req.params.id);
      req.flash('success', 'Estado del proveedor actualizado.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cambiar el estado.');
    }
    res.redirect('/proveedores');
  }
};

module.exports = supplierController;
