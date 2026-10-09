function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Debes iniciar sesión para acceder.');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.roles || !req.session.roles.includes('admin')) {
    return res.status(403).render('403', { title: 'Acceso denegado' });
  }
  next();
}

module.exports = { requireLogin, requireAdmin };
