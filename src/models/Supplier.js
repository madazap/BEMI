const db = require('../config/db');

const Supplier = {

  async findAll() {
    const [rows] = await db.execute(
      'SELECT * FROM suppliers ORDER BY name'
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await db.execute(
      'SELECT * FROM suppliers WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  async findActive() {
    const [rows] = await db.execute(
      'SELECT id, name FROM suppliers WHERE is_active = 1 ORDER BY name'
    );
    return rows;
  },

  async create({ name, contact_name, phone, email }) {
    const [result] = await db.execute(
      'INSERT INTO suppliers (name, contact_name, phone, email) VALUES (?, ?, ?, ?)',
      [name, contact_name || null, phone || null, email || null]
    );
    return result.insertId;
  },

  async update(id, { name, contact_name, phone, email }) {
    await db.execute(
      'UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ? WHERE id = ?',
      [name, contact_name || null, phone || null, email || null, id]
    );
  },

  async toggleActive(id) {
    await db.execute(
      'UPDATE suppliers SET is_active = NOT is_active WHERE id = ?',
      [id]
    );
  }
};

module.exports = Supplier;
