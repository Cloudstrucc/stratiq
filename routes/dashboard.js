const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../db/database');
const { getPortfolioValue } = require('../services/marketData');

const router = express.Router();

// All dashboard routes require auth
router.use(requireAuth);

// ── Helper: get user's default portfolio + context ────────────
async function getDashboardContext(userId) {
  const portfolio = await get(
    'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1', [userId]);

  let positions = [], trades = [], report = null, valueData = {};

  if (portfolio) {
    positions = await all(
      'SELECT * FROM positions WHERE portfolio_id = ? AND is_open = 1 ORDER BY shares * current_price DESC',
      [portfolio.id]
    );
    trades = await all(
      'SELECT * FROM trades WHERE portfolio_id = ? ORDER BY executed_at DESC LIMIT 20',
      [portfolio.id]
    );
    report = await get(
      'SELECT * FROM daily_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT 1',
      [userId]
    );
    valueData = await getPortfolioValue({ all, get }, portfolio.id);
  }

  return { portfolio, positions, trades, report, valueData };
}

// ── GET /dashboard ────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const ctx = await getDashboardContext(req.user.id);
    res.render('dashboard/overview', {
      layout: 'dashboard',
      title: 'Dashboard — Stratiq',
      ...ctx,
      tab: 'overview',
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load dashboard.');
    res.redirect('/');
  }
});

// ── GET /dashboard/portfolio ──────────────────────────────────
router.get('/portfolio', async (req, res) => {
  try {
    const ctx = await getDashboardContext(req.user.id);
    res.render('dashboard/portfolio', {
      layout: 'dashboard',
      title: 'Portfolio — Stratiq',
      ...ctx,
      tab: 'portfolio',
    });
  } catch (err) {
    req.flash('error', 'Could not load portfolio.');
    res.redirect('/dashboard');
  }
});

// ── GET /dashboard/ai-strategy ────────────────────────────────
router.get('/ai-strategy', async (req, res) => {
  try {
    const ctx = await getDashboardContext(req.user.id);
    const conversations = await all(
      'SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY created_at ASC LIMIT 20',
      [req.user.id]
    );
    res.render('dashboard/ai-strategy', {
      layout: 'dashboard',
      title: 'AI Strategy — Stratiq',
      ...ctx,
      conversations,
      tab: 'ai-strategy',
    });
  } catch (err) {
    req.flash('error', 'Could not load AI strategy.');
    res.redirect('/dashboard');
  }
});

// ── GET /dashboard/trades ─────────────────────────────────────
router.get('/trades', async (req, res) => {
  try {
    const portfolio = await get(
      'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1', [req.user.id]);
    const trades = portfolio
      ? await all('SELECT * FROM trades WHERE portfolio_id = ? ORDER BY executed_at DESC LIMIT 100', [portfolio.id])
      : [];
    res.render('dashboard/trades', {
      layout: 'dashboard',
      title: 'Trade History — Stratiq',
      portfolio, trades,
      tab: 'trades',
    });
  } catch (err) {
    req.flash('error', 'Could not load trades.');
    res.redirect('/dashboard');
  }
});

// ── GET /dashboard/reports ────────────────────────────────────
router.get('/reports', async (req, res) => {
  try {
    const reports = await all(
      'SELECT * FROM daily_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT 30',
      [req.user.id]
    );
    const prefs = await get('SELECT * FROM report_prefs WHERE user_id = ?', [req.user.id]);
    res.render('dashboard/reports', {
      layout: 'dashboard',
      title: 'Reports — Stratiq',
      reports, prefs,
      tab: 'reports',
    });
  } catch (err) {
    req.flash('error', 'Could not load reports.');
    res.redirect('/dashboard');
  }
});

// ── GET /dashboard/settings ───────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const portfolio = await get(
      'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1', [req.user.id]);
    const prefs = await get('SELECT * FROM report_prefs WHERE user_id = ?', [req.user.id]);
    res.render('dashboard/settings', {
      layout: 'dashboard',
      title: 'Settings — Stratiq',
      portfolio, prefs,
      tab: 'settings',
    });
  } catch (err) {
    req.flash('error', 'Could not load settings.');
    res.redirect('/dashboard');
  }
});

// ── POST /dashboard/settings ──────────────────────────────────
router.post('/settings', async (req, res) => {
  const { first_name, last_name, timezone, currency, report_email, report_freq } = req.body;
  try {
    await run(`
      UPDATE users SET first_name=?, last_name=?, timezone=?, currency=?,
        report_email=?, report_freq=?, updated_at=datetime('now')
      WHERE id=?`,
      [first_name, last_name, timezone || 'America/Toronto',
       currency || 'USD', report_email, report_freq || 'daily', req.user.id]
    );

    // Report prefs
    const { include_pnl, include_trades, include_ai_commentary, include_news, include_positions, include_health } = req.body;
    await run(`
      INSERT OR REPLACE INTO report_prefs
        (user_id, include_pnl, include_trades, include_ai_commentary, include_news, include_positions, include_health)
      VALUES (?,?,?,?,?,?,?)`,
      [req.user.id,
       include_pnl ? 1 : 0, include_trades ? 1 : 0, include_ai_commentary ? 1 : 0,
       include_news ? 1 : 0, include_positions ? 1 : 0, include_health ? 1 : 0]
    );

    req.flash('success', 'Settings saved.');
    res.redirect('/dashboard/settings');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not save settings.');
    res.redirect('/dashboard/settings');
  }
});

module.exports = router;
