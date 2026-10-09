const { validationResult } = require('express-validator');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');

const productController = {

  async index(req, res) {
    try {
      const filters = {
        segment:    Product.SEGMENTS.includes(req.query.segment) ? req.query.segment : '',
        type:       ['magistral', 'insumo'].includes(req.query.type) ? req.query.type : '',
        supplierId: req.query.supplier_id || '',
        search:     (req.query.search || '').trim(),
        sort:       ['stock', 'vencimiento', 'valor'].includes(req.query.sort) ? req.query.sort : 'nombre'
      };
      const [products, stats, suppliers] = await Promise.all([
        Product.findAll(filters),
        Product.statsBySegment(filters),
        Supplier.findAll()
      ]);
      res.render('products/index', { title: 'Productos', products, stats, filters, suppliers });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar productos.');
      res.redirect('/dashboard');
    }
  },

  async showCreate(req, res) {
    res.render('products/form', { title: 'Nuevo Producto', product: null });
  },

  async create(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect('/productos/nuevo');
    }
    const data = buildProductData(req.body);
    try {
      await Product.create(data);
      req.flash('success', `Producto "${data.generic_name}" creado correctamente.`);
      res.redirect('/productos');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'El SKU ya está registrado.');
      } else {
        console.error(err);
        req.flash('error', 'Error al crear el producto.');
      }
      res.redirect('/productos/nuevo');
    }
  },

  async showEdit(req, res) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).render('404', { title: 'No encontrado' });
      res.render('products/form', { title: 'Editar Producto', product });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el producto.');
      res.redirect('/productos');
    }
  },

  async update(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(' | '));
      return res.redirect(`/productos/${req.params.id}/editar`);
    }
    const data = buildProductData(req.body);
    try {
      await Product.update(req.params.id, data);
      req.flash('success', 'Producto actualizado correctamente.');
      res.redirect('/productos');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'El SKU ya está en uso por otro producto.');
      } else {
        console.error(err);
        req.flash('error', 'Error al actualizar el producto.');
      }
      res.redirect(`/productos/${req.params.id}/editar`);
    }
  },

  async toggleActive(req, res) {
    try {
      await Product.toggleActive(req.params.id);
      req.flash('success', 'Estado del producto actualizado.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cambiar el estado.');
    }
    res.redirect('/productos');
  },

  async api(req, res) {
    try {
      const product = await Product.findForApi(req.params.id);
      if (!product) return res.status(404).json({ error: 'No encontrado' });
      res.json(product);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error interno' });
    }
  }
};

function buildProductData(body) {
  const isMagistral = body.is_magistral === 'on' || body.is_magistral === '1';
  return {
    sku:               body.sku.trim(),
    generic_name:      body.generic_name.trim(),
    commercial_name:   body.commercial_name,
    presentation:      body.presentation,
    concentration:     body.concentration,
    manufacturer:      body.manufacturer,
    sanitary_registry: body.sanitary_registry,
    purchase_unit:     body.purchase_unit.trim(),
    consumption_unit:  body.consumption_unit.trim(),
    conversion_factor: parseFloat(body.conversion_factor) || 1,
    min_stock:         parseFloat(body.min_stock) || 0,
    expiry_alert_days: parseInt(body.expiry_alert_days) || 30,
    is_magistral:      isMagistral,
    sale_price:        body.sale_price ? parseFloat(body.sale_price) : null,
    acquisition_price: body.acquisition_price ? parseFloat(body.acquisition_price) : null
  };
}

module.exports = productController;
