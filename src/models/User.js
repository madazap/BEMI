const db = require('../config/db');
const bcrypt = require('bcryptjs');

const User = {

  async findByEmail(email) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [email]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await db.execute(
      'SELECT id, name, email, is_active, totp_enabled, created_at FROM users WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  // Incluye password_hash y datos de TOTP — solo para el propio flujo de autenticación.
  async findByIdAuth(id) {
    const [rows] = await db.execute(
      'SELECT id, name, email, password_hash, totp_secret, totp_enabled FROM users WHERE id = ? AND is_active = 1',
      [id]
    );
    return rows[0] || null;
  },

  async setTotp(id, secret) {
    await db.execute('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?', [secret, id]);
  },

  async disableTotp(id) {
    await db.execute('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', [id]);
  },

  async findAll() {
    const [rows] = await db.execute(`
      SELECT u.id, u.name, u.email, u.is_active, u.created_at,
             GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ', ') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r      ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.name
    `);
    return rows;
  },

  async create({ name, email, password, roleIds }) {
    const hash = await bcrypt.hash(password, 12);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
        [name, email, hash]
      );
      const userId = result.insertId;
      for (const roleId of roleIds) {
        await conn.execute(
          'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [userId, roleId]
        );
      }
      await conn.commit();
      return userId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async update(id, { name, email, password, roleIds }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      if (password) {
        const hash = await bcrypt.hash(password, 12);
        await conn.execute(
          'UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?',
          [name, email, hash, id]
        );
      } else {
        await conn.execute(
          'UPDATE users SET name = ?, email = ? WHERE id = ?',
          [name, email, id]
        );
      }
      await conn.execute('DELETE FROM user_roles WHERE user_id = ?', [id]);
      for (const roleId of roleIds) {
        await conn.execute(
          'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [id, roleId]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async toggleActive(id) {
    await db.execute(
      'UPDATE users SET is_active = NOT is_active WHERE id = ?',
      [id]
    );
  },

  async verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
  },

  async getRoles() {
    const [rows] = await db.execute('SELECT * FROM roles ORDER BY name');
    return rows;
  },

  async getRolesByUserId(userId) {
    const [rows] = await db.execute(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
      [userId]
    );
    return rows.map(r => r.name);
  },

  async getRoleIdsByUserId(userId) {
    const [rows] = await db.execute(
      'SELECT role_id FROM user_roles WHERE user_id = ?',
      [userId]
    );
    return rows.map(r => r.role_id);
  },

  async findAllActive() {
    const [rows] = await db.execute(
      'SELECT id, name FROM users WHERE is_active = 1 ORDER BY name'
    );
    return rows;
  }
};

module.exports = User;
