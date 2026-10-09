const db = require('../config/db');

const ProfessionalRate = {

  async findAll() {
    const [rows] = await db.execute(
      `SELECT * FROM professional_rates ORDER BY service_type, effective_from DESC`
    );
    return rows;
  },

  async findCurrent() {
    const [rows] = await db.execute(
      `SELECT * FROM professional_rates WHERE effective_to IS NULL ORDER BY service_type`
    );
    return rows;
  },

  async create({ service_type, hourly_rate, effective_from }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE professional_rates
         SET effective_to = DATE_SUB(?, INTERVAL 1 DAY)
         WHERE service_type = ? AND effective_to IS NULL`,
        [effective_from, service_type]
      );
      await conn.execute(
        `INSERT INTO professional_rates (service_type, hourly_rate, effective_from)
         VALUES (?, ?, ?)`,
        [service_type, hourly_rate, effective_from]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
};

module.exports = ProfessionalRate;
