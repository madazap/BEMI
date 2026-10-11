require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express     = require('express');
const helmet      = require('helmet');
const session     = require('express-session');
const MySQLStore  = require('express-mysql-session')(session);
const ejsLayouts  = require('express-ejs-layouts');
const path        = require('path');

const authRoutes            = require('./routes/auth');
const profileRoutes         = require('./routes/profile');
const userRoutes            = require('./routes/users');
const supplierRoutes        = require('./routes/suppliers');
const productRoutes         = require('./routes/products');
const inventoryRoutes       = require('./routes/inventory');
const patientRoutes         = require('./routes/patients');
const treatmentRoutes       = require('./routes/treatments');
const patientTreatmentRoutes = require('./routes/patientTreatments');
const sessionRoutes         = require('./routes/sessions');
const agendaRoutes          = require('./routes/agenda');
const quotationRoutes       = require('./routes/quotations');
const invoiceRoutes         = require('./routes/invoices');
const dashboardRoutes       = require('./routes/dashboard');
const expenseRoutes         = require('./routes/expenses');
const rateRoutes            = require('./routes/rates');
const helpRoutes            = require('./routes/help');
const { requireLogin } = require('./middleware/auth');

const app = express();

// Detrás del proxy inverso (OpenLiteSpeed) en producción: necesario para
// que la cookie `secure` se envíe y el rate-limit vea la IP real del cliente
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Seguridad HTTP headers
app.use(helmet({ contentSecurityPolicy: false }));

// Body parsing
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Archivos estáticos
app.use(express.static(path.join(__dirname, '..', 'public')));

// Motor de vistas con layouts
app.set('view engine', 'ejs');
app.locals.MAGISTRAL_LABEL  = require('./config/constants').MAGISTRAL_LABEL;
app.locals.TREATMENT_TYPES = require('./config/constants').TREATMENT_TYPES;
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');

// Sesiones persistidas en MySQL
const sessionStore = new MySQLStore({
  host:                    process.env.DB_HOST,
  port:                    process.env.DB_PORT || 3306,
  user:                    process.env.DB_USER,
  password:                process.env.DB_PASS,
  database:                process.env.DB_NAME,
  connectionLimit:         1,
  createDatabaseTable:     true,
  expiration:              8 * 60 * 60 * 1000,
  clearExpired:            true,
  checkExpirationInterval: 15 * 60 * 1000,
  schema: {
    tableName:   'http_sessions',   // evita conflicto con tabla `sessions` del CRM
    columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
  }
});

app.use(session({
  name:              'sid',
  secret:            process.env.SESSION_SECRET,
  store:             sessionStore,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   8 * 60 * 60 * 1000  // 8 horas
  }
}));

// Flash messages via sesión (sin librería extra)
app.use((req, res, next) => {
  req.flash = (type, msg) => {
    if (req.session) {
      req.session.flash = req.session.flash || {};
      req.session.flash[type] = msg;
    }
  };
  res.locals.flash   = req.session?.flash || {};
  if (req.session) delete req.session.flash;

  res.locals.session = {
    userId:   req.session?.userId   ?? null,
    userName: req.session?.userName ?? null,
    roles:    req.session?.roles    ?? []
  };
  res.locals.currentPath = req.path;
  next();
});

// Rutas
app.use('/', authRoutes);
app.use('/mi-cuenta', profileRoutes);
app.use('/usuarios', userRoutes);
app.use('/proveedores', supplierRoutes);
app.use('/productos', productRoutes);
app.use('/', inventoryRoutes);
app.use('/pacientes', patientRoutes);
app.use('/tratamientos', treatmentRoutes);
app.use('/', patientTreatmentRoutes);
app.use('/sesiones', sessionRoutes);
app.use('/', agendaRoutes);
app.use('/cotizaciones', quotationRoutes);
app.use('/facturas',     invoiceRoutes);
app.use('/',             dashboardRoutes);
app.use('/gastos',       expenseRoutes);
app.use('/tarifas',      rateRoutes);
app.use('/',             helpRoutes);

app.get('/', (req, res) => res.redirect('/dashboard'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: 'Página no encontrada' });
});

// Error handler — no exponer stack trace al cliente ni en logs en producción
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  } else {
    console.error(`[ERROR] ${err.message}`);
  }
  res.locals.session = res.locals.session || { userId: null, userName: null, roles: [] };
  res.locals.flash   = res.locals.flash   || {};
  res.status(500).render('500', { title: 'Error interno' });
});

module.exports = app;
