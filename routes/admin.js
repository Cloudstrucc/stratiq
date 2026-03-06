const express        = require('express');
const { requireAdmin } = require('../middleware/auth');
const { all, get, run } = require('../db/database');

const router = express.Router();
router.use(requireAdmin);

// ── GET /admin ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [users, portfolios, trades, reports] = await Promise.all([
      all('SELECT id, first_name, last_name, email, role, plan, is_active, created_at, last_login_at FROM users ORDER BY created_at DESC'),
      all('SELECT COUNT(*) AS count FROM portfolios'),
      all('SELECT COUNT(*) AS count FROM trades'),
      all('SELECT COUNT(*) AS count FROM daily_reports WHERE email_sent = 1'),
    ]);

    const stats = {
      totalUsers:      users.length,
      activeUsers:     users.filter(u => u.is_active).length,
      proUsers:        users.filter(u => u.plan === 'pro' || u.plan === 'unlimited').length,
      totalPortfolios: portfolios[0]?.count || 0,
      totalTrades:     trades[0]?.count || 0,
      emailsSent:      reports[0]?.count || 0,
    };

    res.render('admin/dashboard', {
      layout: 'dashboard',
      title: 'Admin — Stratiq',
      users, stats,
      tab: 'admin',
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load admin dashboard.');
    res.redirect('/dashboard');
  }
});

// ── POST /admin/users/:id/toggle ──────────────────────────────
router.post('/users/:id/toggle', async (req, res) => {
  try {
    const user = await get('SELECT id, is_active, role FROM users WHERE id=?', [req.params.id]);
    if (!user || user.role === 'admin') {
      req.flash('error', 'Cannot modify admin accounts.');
      return res.redirect('/admin');
    }
    await run('UPDATE users SET is_active = ? WHERE id=?',
      [user.is_active ? 0 : 1, user.id]);
    req.flash('success', `User ${user.is_active ? 'deactivated' : 'activated'}.`);
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Could not update user.');
    res.redirect('/admin');
  }
});

// ── POST /admin/users/:id/plan ────────────────────────────────
router.post('/users/:id/plan', async (req, res) => {
  const { plan } = req.body;
  const valid = ['free', 'pro', 'unlimited'];
  if (!valid.includes(plan)) {
    req.flash('error', 'Invalid plan.');
    return res.redirect('/admin');
  }
  try {
    await run('UPDATE users SET plan=? WHERE id=?', [plan, req.params.id]);
    req.flash('success', 'Plan updated.');
    res.redirect('/admin');
  } catch (err) {
    req.flash('error', 'Could not update plan.');
    res.redirect('/admin');
  }
});

module.exports = router;
