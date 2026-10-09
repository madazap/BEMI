const express = require('express');
const router  = express.Router();
const { requireLogin } = require('../middleware/auth');

router.get('/ayuda', requireLogin, (req, res) => {
  res.render('help', { title: 'Ayuda' });
});

module.exports = router;
