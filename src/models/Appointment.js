const db = require('../config/db');

const Appointment = {

  async findById(id) {
    const [rows] = await db.execute(`
      SELECT a.*,
             p.full_name  AS patient_name,
             u.name       AS professional_name,
             s.session_number, s.is_control,
             t.name       AS treatment_name
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN users    u ON u.id = a.professional_id
      LEFT JOIN sessions s          ON s.id = a.session_id
      LEFT JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
      LEFT JOIN treatments t         ON t.id  = pt.treatment_id
      WHERE a.id = ?
    `, [id]);
    return rows[0] || null;
  },

  async findForCalendar({ start, end }) {
    const [rows] = await db.execute(`
      SELECT a.id, a.status, a.scheduled_at, a.duration_minutes,
             p.full_name AS patient_name,
             t.name      AS treatment_name
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      LEFT JOIN sessions s          ON s.id = a.session_id
      LEFT JOIN patient_treatments pt ON pt.id = s.patient_treatment_id
      LEFT JOIN treatments t         ON t.id  = pt.treatment_id
      WHERE a.scheduled_at BETWEEN ? AND ?
      ORDER BY a.scheduled_at
    `, [start, end]);
    return rows.map(r => ({
      id:    r.id,
      title: r.treatment_name ? `${r.patient_name} — ${r.treatment_name}` : r.patient_name,
      start: r.scheduled_at,
      end:   new Date(new Date(r.scheduled_at).getTime() + r.duration_minutes * 60000),
      extendedProps: {
        status:         r.status,
        patient_name:   r.patient_name,
        treatment_name: r.treatment_name || null
      }
    }));
  },

  async findUpcoming(limit = 10) {
    const n = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const [rows] = await db.query(`
      SELECT a.id, a.scheduled_at, a.duration_minutes, a.status,
             p.full_name AS patient_name,
             u.name      AS professional_name
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN users    u ON u.id = a.professional_id
      WHERE a.scheduled_at >= NOW()
        AND a.status NOT IN ('cancelada','realizada')
      ORDER BY a.scheduled_at
      LIMIT ${n}
    `);
    return rows;
  },

  async create({ patient_id, session_id, professional_id, scheduled_at, duration_minutes, notes, created_by }) {
    const [result] = await db.execute(
      `INSERT INTO appointments
         (patient_id, session_id, professional_id, scheduled_at, duration_minutes, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [patient_id, session_id || null, professional_id, scheduled_at,
       duration_minutes || 60, notes || null, created_by]
    );
    return result.insertId;
  },

  async update(id, { professional_id, scheduled_at, duration_minutes, notes }) {
    await db.execute(
      `UPDATE appointments
       SET professional_id=?, scheduled_at=?, duration_minutes=?, notes=?
       WHERE id=?`,
      [professional_id, scheduled_at, duration_minutes || 60, notes || null, id]
    );
  },

  async updateStatus(id, status) {
    await db.execute('UPDATE appointments SET status=? WHERE id=?', [status, id]);
  },

  async findBySessionId(sessionId) {
    const [rows] = await db.execute(
      'SELECT id FROM appointments WHERE session_id = ? LIMIT 1',
      [sessionId]
    );
    return rows[0] || null;
  },

  async findConflict({ professional_id, scheduled_at, duration_minutes, excludeId }) {
    let sql = `
      SELECT a.id, a.scheduled_at, a.duration_minutes,
             p.full_name AS patient_name
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE a.professional_id = ?
        AND a.status != 'cancelada'
        AND a.scheduled_at < DATE_ADD(?, INTERVAL ? MINUTE)
        AND DATE_ADD(a.scheduled_at, INTERVAL a.duration_minutes MINUTE) > ?
    `;
    const params = [professional_id, scheduled_at, duration_minutes || 60, scheduled_at];
    if (excludeId) {
      sql += ' AND a.id != ?';
      params.push(excludeId);
    }
    sql += ' LIMIT 1';
    const [rows] = await db.execute(sql, params);
    return rows[0] || null;
  }
};

module.exports = Appointment;
