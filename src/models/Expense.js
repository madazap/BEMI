const db = require('../config/db');

const Expense = {

  async findAllCategories() {
    const [rows] = await db.execute(
      'SELECT * FROM expense_categories ORDER BY name'
    );
    return rows;
  },

  async createCategory({ name, created_by }) {
    const [result] = await db.execute(
      'INSERT INTO expense_categories (name, created_by) VALUES (?, ?)',
      [name, created_by]
    );
    return result.insertId;
  },

  async toggleCategory(id) {
    await db.execute(
      'UPDATE expense_categories SET is_active = NOT is_active WHERE id = ?',
      [id]
    );
  },

  async findByMonth(month) {
    const [rows] = await db.execute(
      `SELECT fe.*, ec.name AS category_name
       FROM fixed_expenses fe
       JOIN expense_categories ec ON ec.id = fe.category_id
       WHERE fe.month = ?
       ORDER BY ec.name`,
      [month]
    );
    return rows;
  },

  async upsertFixed({ category_id, month, amount, registered_by }) {
    await db.execute(
      `INSERT INTO fixed_expenses (category_id, month, amount, registered_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), registered_by = VALUES(registered_by)`,
      [category_id, month, amount, registered_by]
    );
  },

  async getMonthlySummary(month) {
    const [year, m] = month.split('-').map(Number);

    const [fixedItems] = await db.execute(
      `SELECT ec.id AS category_id, ec.name, COALESCE(fe.amount, 0) AS amount
       FROM expense_categories ec
       LEFT JOIN fixed_expenses fe ON fe.category_id = ec.id AND fe.month = ?
       WHERE ec.is_active = 1
       ORDER BY ec.name`,
      [month]
    );

    const fixed_total = fixedItems.reduce((s, r) => s + Number(r.amount), 0);

    const occasionalItems = await Expense.findOccasionalByMonth(month);
    const occasional_total = occasionalItems.reduce((s, r) => s + Number(r.amount), 0);

    const [[insRow]] = await db.execute(
      `SELECT COALESCE(SUM(total_cost), 0) AS total
       FROM stock_entries
       WHERE YEAR(entry_date) = ? AND MONTH(entry_date) = ?`,
      [year, m]
    );

    const [[laborRow]] = await db.execute(
      `SELECT COALESCE(SUM(s.professional_hours * pr.hourly_rate), 0) AS total
       FROM sessions s
       JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
       JOIN treatments t ON t.id = pt.treatment_id
       JOIN professional_rates pr ON pr.service_type = t.type
         AND pr.effective_from <= s.performed_date
         AND (pr.effective_to IS NULL OR pr.effective_to >= s.performed_date)
       WHERE s.status = 'realizada'
         AND YEAR(s.performed_date) = ? AND MONTH(s.performed_date) = ?`,
      [year, m]
    );

    const insumos_total = Number(insRow.total);
    const labor_total   = Number(laborRow.total);

    return {
      fixed_items:    fixedItems,
      fixed_total,
      occasional_items: occasionalItems,
      occasional_total,
      insumos_total,
      labor_total,
      grand_total: fixed_total + occasional_total + insumos_total + labor_total
    };
  },

  async findOccasionalByMonth(month) {
    const [rows] = await db.execute(
      `SELECT oe.*, u.name AS registered_by_name
       FROM occasional_expenses oe
       JOIN users u ON u.id = oe.registered_by
       WHERE DATE_FORMAT(oe.expense_date, '%Y-%m') = ?
       ORDER BY oe.expense_date DESC, oe.id DESC`,
      [month]
    );
    return rows;
  },

  async createOccasional({ title, description, amount, expense_date, registered_by }) {
    const [result] = await db.execute(
      `INSERT INTO occasional_expenses (title, description, amount, expense_date, registered_by)
       VALUES (?, ?, ?, ?, ?)`,
      [title, description || null, amount, expense_date, registered_by]
    );
    return result.insertId;
  },

  async deleteOccasional(id) {
    await db.execute('DELETE FROM occasional_expenses WHERE id = ?', [id]);
  },

  async findFixedByRange(from, to) {
    const [rows] = await db.execute(
      `SELECT fe.id, STR_TO_DATE(CONCAT(fe.month, '-01'), '%Y-%m-%d') AS date,
              fe.amount, ec.name AS category_name
       FROM fixed_expenses fe
       JOIN expense_categories ec ON ec.id = fe.category_id
       WHERE STR_TO_DATE(CONCAT(fe.month, '-01'), '%Y-%m-%d') BETWEEN ? AND ?
       ORDER BY fe.month`,
      [from, to]
    );
    return rows;
  },

  async findOccasionalByRange(from, to) {
    const [rows] = await db.execute(
      `SELECT oe.id, oe.expense_date AS date, oe.amount, oe.title, oe.description
       FROM occasional_expenses oe
       WHERE oe.expense_date BETWEEN ? AND ?
       ORDER BY oe.expense_date`,
      [from, to]
    );
    return rows;
  }
};

module.exports = Expense;
