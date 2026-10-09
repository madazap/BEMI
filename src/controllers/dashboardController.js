const Dashboard = require('../models/Dashboard');
const MagistralRenewal = require('../models/MagistralRenewal');

const dashboardController = {

  async index(req, res) {
    try {
      const now   = new Date();
      const year  = parseInt(req.query.year)  || now.getFullYear();
      const month = parseInt(req.query.month) || now.getMonth() + 1;
      const period = { year, month };

      const [revenue, expenses, sessionsCount, appointmentsCount,
             revenueTrend, profitability, topPatients, paymentMethods, magistrals, renewals] =
        await Promise.all([
          Dashboard.getMonthlyRevenue(period),
          Dashboard.getMonthlyExpenses(period),
          Dashboard.getSessionsCount(period),
          Dashboard.getAppointmentsCount(period),
          Dashboard.getRevenueTrend(),
          Dashboard.getTreatmentProfitability(),
          Dashboard.getTopPatients({ year }),
          Dashboard.getPaymentMethods(period),
          Dashboard.getMagistralProfitability(period),
          MagistralRenewal.pendingAlerts()
        ]);

      const netMargin = revenue - expenses.total;

      res.render('dashboard', {
        title: 'Panel Principal',
        year, month,
        revenue, expenses, sessionsCount, appointmentsCount,
        netMargin, revenueTrend, profitability, topPatients, paymentMethods, magistrals, renewals
      });
    } catch (err) {
      console.error(err);
      req.flash('error', 'Error al cargar el panel.');
      res.render('dashboard', {
        title: 'Panel Principal',
        year: new Date().getFullYear(), month: new Date().getMonth() + 1,
        revenue: 0, expenses: { fixed: 0, insumos: 0, labor: 0, total: 0 },
        sessionsCount: 0, appointmentsCount: 0, netMargin: 0,
        revenueTrend: [], profitability: [], topPatients: [], paymentMethods: [],
        magistrals: { month: { units: 0, revenue: 0, cost: 0, margin: 0, lines_without_cost: 0 }, byProduct: [] },
        renewals: []
      });
    }
  }
};

module.exports = dashboardController;
