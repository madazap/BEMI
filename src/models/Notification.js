const db = require('../config/db');
const MagistralRenewal = require('./MagistralRenewal');

const Notification = {

  async getCounts() {
    const [[lowRow]] = await db.execute(`
      SELECT COUNT(*) AS cnt
      FROM products p
      WHERE p.is_active = 1
        AND p.min_stock > 0
        AND (
          COALESCE((SELECT SUM(consumption_quantity) FROM stock_entries WHERE product_id = p.id), 0) -
          COALESCE((SELECT SUM(quantity) FROM stock_exits WHERE product_id = p.id), 0)
        ) <= p.min_stock
    `);

    const [[expRow]] = await db.execute(`
      SELECT COUNT(*) AS cnt
      FROM stock_entries se
      JOIN products p ON p.id = se.product_id
      WHERE p.is_active = 1
        AND se.expiry_date IS NOT NULL
        AND se.expiry_date <= DATE_ADD(CURDATE(), INTERVAL p.expiry_alert_days DAY)
        AND (
          se.consumption_quantity -
          COALESCE((SELECT SUM(quantity) FROM stock_exits WHERE stock_entry_id = se.id), 0)
        ) > 0
    `);

    const magistralRenewals = (await MagistralRenewal.pendingAlerts()).length;

    return { lowStock: lowRow.cnt, expiringLots: expRow.cnt, magistralRenewals };
  }
};

module.exports = Notification;
