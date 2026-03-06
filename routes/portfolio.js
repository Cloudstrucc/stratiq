const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db/database');
const { getPrice } = require('../services/marketData');

const router = express.Router();
router.use(requireAuth);

// ── POST /portfolio/add-position ──────────────────────────────
router.post('/add-position', async (req, res) => {
  const { symbol, asset_type, shares, buy_price } = req.body;
  if (!symbol || !shares || parseFloat(shares) <= 0) {
    req.flash('error', 'Symbol and valid share count required.');
    return res.redirect('/dashboard/portfolio');
  }

  try {
    const portfolio = await get(
      'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1', [req.user.id]);
    if (!portfolio) throw new Error('No portfolio found');

    // Get current price
    const priceData = await getPrice(symbol.toUpperCase());
    const price     = parseFloat(buy_price) || priceData.price;
    const qty       = parseFloat(shares);
    const total     = price * qty;

    if (total > portfolio.cash_balance) {
      req.flash('error', `Insufficient cash. You have $${portfolio.cash_balance.toFixed(2)} available.`);
      return res.redirect('/dashboard/portfolio');
    }

    // Upsert position
    const existing = await get(
      'SELECT * FROM positions WHERE portfolio_id = ? AND symbol = ?',
      [portfolio.id, symbol.toUpperCase()]
    );

    if (existing) {
      const newShares  = existing.shares + qty;
      const newAvgCost = ((existing.shares * existing.avg_cost) + total) / newShares;
      await run(
        'UPDATE positions SET shares=?, avg_cost=?, current_price=?, is_open=1, updated_at=datetime(\'now\') WHERE id=?',
        [newShares, newAvgCost, price, existing.id]
      );
    } else {
      await run(`
        INSERT INTO positions (portfolio_id, symbol, name, asset_type, shares, avg_cost, current_price, last_price_update)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [portfolio.id, symbol.toUpperCase(), priceData.name || symbol.toUpperCase(),
         asset_type || 'stock', qty, price, price]
      );
    }

    // Deduct cash + log trade
    await run('UPDATE portfolios SET cash_balance = cash_balance - ? WHERE id = ?', [total, portfolio.id]);
    await run(`
      INSERT INTO trades (portfolio_id, symbol, asset_type, trade_type, shares, price, total_value, ai_generated, reason)
      VALUES (?, ?, ?, 'buy', ?, ?, ?, 0, 'Manual buy')`,
      [portfolio.id, symbol.toUpperCase(), asset_type || 'stock', qty, price, total]
    );

    req.flash('success', `Added ${qty} × ${symbol.toUpperCase()} @ $${price.toFixed(2)}`);
    res.redirect('/dashboard/portfolio');
  } catch (err) {
    console.error('Add position error:', err);
    req.flash('error', 'Could not add position. Please try again.');
    res.redirect('/dashboard/portfolio');
  }
});

// ── POST /portfolio/sell/:positionId ─────────────────────────
router.post('/sell/:positionId', async (req, res) => {
  const { shares } = req.body;
  try {
    const position = await get(
      `SELECT pos.*, port.user_id, port.id AS port_id, port.cash_balance
       FROM positions pos
       JOIN portfolios port ON port.id = pos.portfolio_id
       WHERE pos.id = ?`, [req.params.positionId]
    );
    if (!position || position.user_id !== req.user.id) {
      req.flash('error', 'Position not found.');
      return res.redirect('/dashboard/portfolio');
    }

    const qty   = parseFloat(shares) || position.shares;
    const price = position.current_price;
    const total = qty * price;

    if (qty > position.shares) {
      req.flash('error', `You only hold ${position.shares} shares.`);
      return res.redirect('/dashboard/portfolio');
    }

    const remaining = position.shares - qty;
    if (remaining <= 0.0001) {
      await run('UPDATE positions SET is_open=0, shares=0 WHERE id=?', [position.id]);
    } else {
      await run('UPDATE positions SET shares=? WHERE id=?', [remaining, position.id]);
    }

    await run('UPDATE portfolios SET cash_balance = cash_balance + ? WHERE id=?', [total, position.port_id]);
    await run(`
      INSERT INTO trades (portfolio_id, symbol, asset_type, trade_type, shares, price, total_value, ai_generated, reason)
      VALUES (?, ?, ?, 'sell', ?, ?, ?, 0, 'Manual sell')`,
      [position.port_id, position.symbol, position.asset_type, qty, price, total]
    );

    req.flash('success', `Sold ${qty} × ${position.symbol} @ $${price.toFixed(2)}`);
    res.redirect('/dashboard/portfolio');
  } catch (err) {
    console.error('Sell error:', err);
    req.flash('error', 'Could not execute sell order.');
    res.redirect('/dashboard/portfolio');
  }
});

// ── POST /portfolio/strategy ──────────────────────────────────
router.post('/strategy', async (req, res) => {
  const { strategy_key, strategy_prompt, risk_level, rebalance_freq, ai_enabled, sim_budget } = req.body;
  try {
    const portfolio = await get(
      'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1', [req.user.id]);
    if (!portfolio) throw new Error('No portfolio');

    await run(`
      UPDATE portfolios SET
        strategy_key=?, strategy_prompt=?, risk_level=?, rebalance_freq=?,
        ai_enabled=?, updated_at=datetime('now')
      WHERE id=?`,
      [strategy_key || 'manual', strategy_prompt || null,
       risk_level || 'moderate', rebalance_freq || 'weekly',
       ai_enabled ? 1 : 0, portfolio.id]
    );

    if (sim_budget) {
      const budget = parseFloat(sim_budget);
      await run(
        'UPDATE users SET sim_budget=? WHERE id=?', [budget, req.user.id]);
    }

    req.flash('success', 'Strategy settings updated.');
    res.redirect('/dashboard/ai-strategy');
  } catch (err) {
    console.error('Strategy update error:', err);
    req.flash('error', 'Could not update strategy.');
    res.redirect('/dashboard/ai-strategy');
  }
});

// ── POST /portfolio/reset ─────────────────────────────────────
router.post('/reset', async (req, res) => {
  try {
    const portfolio = await get(
      'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1', [req.user.id]);
    if (!portfolio) throw new Error('No portfolio');

    const user = await get('SELECT sim_budget FROM users WHERE id=?', [req.user.id]);
    await run('UPDATE positions SET is_open=0 WHERE portfolio_id=?', [portfolio.id]);
    await run('UPDATE portfolios SET cash_balance=? WHERE id=?', [user.sim_budget, portfolio.id]);

    req.flash('success', `Portfolio reset to $${user.sim_budget.toLocaleString()}.`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Reset error:', err);
    req.flash('error', 'Could not reset portfolio.');
    res.redirect('/dashboard/settings');
  }
});

module.exports = router;
