const express             = require('express');
const dashboardController = require('../controllers/dashboardController');
const { requireLogin }    = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', requireLogin, dashboardController.index);

module.exports = router;
