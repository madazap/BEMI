const { body, validationResult } = require('express-validator');
const Expense  = require('../models/Expense');
const Invoice  = require('../models/Invoice');

const expenseController = {

  async index(req, res) {
    try {
      const now     = new Date();
      const month   = req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const summary = await Expense.getMonthlySummary(month);
      res.render('expenses/index', { title: 'Gestión de Gastos', month, summary });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar gastos.');
      res.redirect('/dashboard');
    }
  },

  async createOccasional(req, res) {
    const { title, description, amount, expense_date, month } = req.body;
    const value = parseFloat(amount);
    if (!title || !expense_date || !(value > 0)) {
      req.flash('error', 'Título, fecha y monto son requeridos.');
      return res.redirect(`/gastos?month=${month || ''}`);
    }
    try {
      await Expense.createOccasional({
        title: title.trim(),
        description: (description || '').trim(),
        amount: value,
        expense_date,
        registered_by: req.session.userId
      });
      req.flash('success', 'Gasto ocasional registrado.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al registrar el gasto ocasional.');
    }
    res.redirect(`/gastos?month=${month || expense_date.slice(0, 7)}`);
  },

  async deleteOccasional(req, res) {
    try {
      await Expense.deleteOccasional(req.params.id);
      req.flash('success', 'Gasto ocasional eliminado.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al eliminar el gasto ocasional.');
    }
    res.redirect(`/gastos?month=${req.body.month || ''}`);
  },

  async report(req, res) {
    try {
      const now = new Date();
      const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const today = now.toISOString().slice(0, 10);

      const from = req.query.from || firstOfMonth;
      const to   = req.query.to   || today;

      const [payments, fixedExpenses, occasionalExpenses] = await Promise.all([
        Invoice.findPaymentsByRange(from, `${to} 23:59:59`),
        Expense.findFixedByRange(from, to),
        Expense.findOccasionalByRange(from, to)
      ]);

      const income = payments.map(p => ({
        date:        p.date,
        concept:     p.treatment_name || 'Tratamiento facturado',
        detail:      `${p.patient_name} — ${p.method}`,
        amount:      Number(p.amount)
      }));

      const expenses = [
        ...fixedExpenses.map(e => ({
          date:    e.date,
          type:    'Fijo',
          concept: e.category_name,
          detail:  `Gasto fijo — ${e.category_name}`,
          amount:  Number(e.amount)
        })),
        ...occasionalExpenses.map(e => ({
          date:    e.date,
          type:    'Ocasional',
          concept: e.title,
          detail:  e.description || '',
          amount:  Number(e.amount)
        }))
      ].sort((a, b) => new Date(a.date) - new Date(b.date));

      const totalIncome   = income.reduce((s, r) => s + r.amount, 0);
      const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

      res.render('expenses/report', {
        title: 'Informe de Ingresos y Egresos',
        from, to,
        income, expenses,
        totalIncome, totalExpenses,
        net: totalIncome - totalExpenses
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al generar el informe.');
      res.redirect('/gastos');
    }
  },

  async saveMonth(req, res) {
    try {
      const { month } = req.body;
      const catIds  = toArray(req.body.category_id);
      const amounts = toArray(req.body.amount);

      for (let i = 0; i < catIds.length; i++) {
        const amount = parseFloat(amounts[i]) || 0;
        if (amount > 0) {
          await Expense.upsertFixed({
            category_id:   catIds[i],
            month,
            amount,
            registered_by: req.session.userId
          });
        }
      }
      req.flash('success', 'Gastos del mes guardados.');
      res.redirect(`/gastos?month=${month}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al guardar gastos.');
      res.redirect('/gastos');
    }
  },

  async categories(req, res) {
    try {
      const categories = await Expense.findAllCategories();
      res.render('expenses/categories', { title: 'Categorías de Gastos', categories });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar categorías.');
      res.redirect('/gastos');
    }
  },

  async createCategory(req, res) {
    const name = (req.body.name || '').trim();
    if (!name) {
      req.flash('error', 'El nombre es requerido.');
      return res.redirect('/gastos/categorias');
    }
    try {
      await Expense.createCategory({ name, created_by: req.session.userId });
      req.flash('success', `Categoría "${name}" creada.`);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'Ya existe una categoría con ese nombre.');
      } else {
        console.error(err);
        req.flash('error', 'Error al crear la categoría.');
      }
    }
    res.redirect('/gastos/categorias');
  },

  async toggleCategory(req, res) {
    try {
      await Expense.toggleCategory(req.params.id);
      req.flash('success', 'Estado de la categoría actualizado.');
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al actualizar la categoría.');
    }
    res.redirect('/gastos/categorias');
  }
};

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

module.exports = expenseController;
