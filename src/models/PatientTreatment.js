const db = require('../config/db');

const PatientTreatment = {

  async findByPatient(patientId) {
    const [rows] = await db.execute(`
      SELECT pt.id, pt.payment_plan, pt.status, pt.start_date,
             t.name AS treatment_name, t.type, t.total_sessions,
             SUM(CASE WHEN s.status = 'realizada' AND s.is_control = 0 THEN 1 ELSE 0 END) AS done_sessions,
             SUM(CASE WHEN s.is_control = 0 THEN 1 ELSE 0 END) AS regular_sessions,
             MAX(s.is_control) AS has_control,
             MAX(CASE WHEN s.is_control = 1 AND s.status = 'realizada' THEN 1 ELSE 0 END) AS control_done,
             COUNT(s.id) AS total_session_rows
      FROM patient_treatments pt
      JOIN treatments t ON t.id = pt.treatment_id
      LEFT JOIN sessions s ON s.patient_treatment_id = pt.id
      WHERE pt.patient_id = ?
      GROUP BY pt.id
      ORDER BY pt.start_date DESC
    `, [patientId]);
    return rows;
  },

  async findById(id) {
    const [rows] = await db.execute(`
      SELECT pt.*, t.name AS treatment_name, t.type, t.total_sessions,
             t.sale_price, t.execution_cost,
             p.full_name AS patient_name, p.id AS patient_id
      FROM patient_treatments pt
      JOIN treatments t ON t.id = pt.treatment_id
      JOIN patients   p ON p.id = pt.patient_id
      WHERE pt.id = ?
    `, [id]);
    return rows[0] || null;
  },

  async create({ patient_id, treatment_id, payment_plan, start_date, created_by }) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [result] = await conn.execute(
        `INSERT INTO patient_treatments (patient_id, treatment_id, payment_plan, start_date, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [patient_id, treatment_id, payment_plan, start_date, created_by]
      );
      const ptId = result.insertId;

      const [[treatment]] = await conn.execute(
        'SELECT total_sessions, requires_control FROM treatments WHERE id = ?',
        [treatment_id]
      );
      for (let i = 1; i <= treatment.total_sessions; i++) {
        await conn.execute(
          `INSERT INTO sessions (patient_treatment_id, session_number, status)
           VALUES (?, ?, 'pendiente')`,
          [ptId, i]
        );
      }
      if (treatment.requires_control) {
        await conn.execute(
          `INSERT INTO sessions (patient_treatment_id, session_number, is_control, status)
           VALUES (?, ?, 1, 'pendiente')`,
          [ptId, treatment.total_sessions + 1]
        );
      }

      await conn.commit();
      return ptId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async updateStatus(id, status) {
    await db.execute('UPDATE patient_treatments SET status = ? WHERE id = ?', [status, id]);
  },

  async findActiveByPatient(patientId) {
    const [rows] = await db.execute(`
      SELECT pt.id, pt.status, pt.payment_plan, t.name AS treatment_name
      FROM patient_treatments pt
      JOIN treatments t ON t.id = pt.treatment_id
      WHERE pt.patient_id = ? AND pt.status = 'activo'
      ORDER BY pt.start_date DESC
    `, [patientId]);
    return rows;
  }
};

module.exports = PatientTreatment;
