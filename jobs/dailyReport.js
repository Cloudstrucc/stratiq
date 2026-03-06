/**
 * Stratiq Daily Jobs
 * - 08:00 AM daily: Generate AI summaries + send email reports
 * - Market hours: Update portfolio prices
 * - Weekly: Trigger AI rebalancing for AI-enabled portfolios
 */

const cron    = require('node-cron');
const db      = require('../db/database');
const ai      = require('../services/aiService');
const email   = require('../services/emailService');
const market  = require('../services/marketData');

// ── Daily Report Job — 8:00 AM every day ─────────────────────
const dailyReportJob = cron.schedule('0 8 * * *', async () => {
  console.log('📧 [CRON] Daily report job started:', new Date().toISOString());

  try {
    // Get all active users with daily/weekday reports
    const users = await db.all(`
      SELECT u.*, rp.*
      FROM users u
      LEFT JOIN report_prefs rp ON rp.user_id = u.id
      WHERE u.is_active = 1
        AND u.report_freq IN ('daily', 'weekdays')
        AND u.report_email IS NOT NULL
    `);

    const today     = new Date();
    const isWeekday = today.getDay() >= 1 && today.getDay() <= 5;

    for (const user of users) {
      if (user.report_freq === 'weekdays' && !isWeekday) continue;

      try {
        // Get default portfolio
        const portfolio = await db.get(
          'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1',
          [user.id]
        );
        if (!portfolio) continue;

        // Get open positions
        const positions = await db.all(
          'SELECT * FROM positions WHERE portfolio_id = ? AND is_open = 1',
          [portfolio.id]
        );

        // Get today's trades
        const todayTrades = await db.all(`
          SELECT * FROM trades
          WHERE portfolio_id = ?
            AND date(executed_at) = date('now')`,
          [portfolio.id]
        );

        // Calculate P&L
        const valueData = await market.getPortfolioValue(db, portfolio.id);

        // Generate AI summary
        const pnl     = valueData.totalPnL;
        const summary = await ai.generateDailySummary(user, portfolio, positions, todayTrades, pnl);

        // Save report
        const todayStr = new Date().toISOString().split('T')[0];
        const existing = await db.get(
          'SELECT id FROM daily_reports WHERE user_id = ? AND report_date = ?',
          [user.id, todayStr]
        );

        let reportId;
        if (existing) {
          await db.run(`
            UPDATE daily_reports SET
              portfolio_value = ?, daily_pnl = ?, daily_pnl_pct = ?,
              total_trades = ?, ai_summary = ?
            WHERE id = ?`,
            [valueData.totalValue, pnl, valueData.totalPnLPct, todayTrades.length, summary, existing.id]
          );
          reportId = existing.id;
        } else {
          const res = await db.run(`
            INSERT INTO daily_reports
              (user_id, portfolio_id, report_date, portfolio_value, daily_pnl, daily_pnl_pct, total_trades, ai_summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, portfolio.id, todayStr, valueData.totalValue, pnl, valueData.totalPnLPct, todayTrades.length, summary]
          );
          reportId = res.lastID;
        }

        const report = await db.get('SELECT * FROM daily_reports WHERE id = ?', [reportId]);

        // Send email
        const sent = await email.sendDailyReport(user, report, portfolio, positions);
        if (sent) {
          await db.run(
            'UPDATE daily_reports SET email_sent = 1, email_sent_at = datetime(\'now\') WHERE id = ?',
            [reportId]
          );
          console.log(`  ✅ Report sent to ${user.email}`);
        }

      } catch (userErr) {
        console.error(`  ❌ Report failed for user ${user.id}:`, userErr.message);
      }
    }
    console.log('📧 [CRON] Daily report job complete');
  } catch (err) {
    console.error('❌ [CRON] Daily report error:', err);
  }
}, { timezone: 'America/Toronto', scheduled: false });


// ── Price Update Job — Every hour during market hours (weekdays 9-4 ET) ──
const priceUpdateJob = cron.schedule('0 9-16 * * 1-5', async () => {
  console.log('📈 [CRON] Price update started');
  try {
    const portfolios = await db.all('SELECT id FROM portfolios');
    for (const p of portfolios) {
      await market.updatePortfolioPrices(db, p.id);
    }
    console.log('📈 [CRON] Price update complete');
  } catch (err) {
    console.error('❌ [CRON] Price update error:', err);
  }
}, { timezone: 'America/Toronto', scheduled: false });


// ── AI Trade Job — Weekdays at 9:30 AM (market open) ─────────
const aiTradeJob = cron.schedule('30 9 * * 1-5', async () => {
  console.log('🤖 [CRON] AI trade simulation started');
  try {
    const portfolios = await db.all(`
      SELECT p.*, u.plan FROM portfolios p
      JOIN users u ON u.id = p.user_id
      WHERE p.ai_enabled = 1 AND u.is_active = 1 AND u.plan IN ('pro','unlimited')`
    );

    for (const portfolio of portfolios) {
      try {
        const positions = await db.all(
          'SELECT * FROM positions WHERE portfolio_id = ? AND is_open = 1',
          [portfolio.id]
        );

        const result = await ai.simulateTrades(portfolio, positions);

        for (const trade of (result.trades || [])) {
          if (!trade.symbol || !trade.action || trade.action === 'hold') continue;

          const price = (await market.getPrice(trade.symbol)).price;
          const total = trade.shares * price;

          if (trade.action === 'buy' && portfolio.cash_balance >= total) {
            await db.run(`
              INSERT INTO trades
                (portfolio_id, symbol, asset_type, trade_type, shares, price, total_value, ai_generated, reason, strategy_key)
              VALUES (?, ?, 'stock', 'buy', ?, ?, ?, 1, ?, ?)`,
              [portfolio.id, trade.symbol.toUpperCase(), trade.shares, price, total, trade.reason, portfolio.strategy_key]
            );
            // Update position
            const existing = await db.get(
              'SELECT * FROM positions WHERE portfolio_id = ? AND symbol = ?',
              [portfolio.id, trade.symbol.toUpperCase()]
            );
            if (existing) {
              const newShares  = existing.shares + trade.shares;
              const newAvgCost = ((existing.shares * existing.avg_cost) + total) / newShares;
              await db.run(
                'UPDATE positions SET shares = ?, avg_cost = ?, current_price = ? WHERE id = ?',
                [newShares, newAvgCost, price, existing.id]
              );
            } else {
              await db.run(`
                INSERT INTO positions (portfolio_id, symbol, asset_type, shares, avg_cost, current_price)
                VALUES (?, ?, 'stock', ?, ?, ?)`,
                [portfolio.id, trade.symbol.toUpperCase(), trade.shares, price, price]
              );
            }
            await db.run(
              'UPDATE portfolios SET cash_balance = cash_balance - ? WHERE id = ?',
              [total, portfolio.id]
            );
          }

          if (trade.action === 'sell') {
            const pos = await db.get(
              'SELECT * FROM positions WHERE portfolio_id = ? AND symbol = ?',
              [portfolio.id, trade.symbol.toUpperCase()]
            );
            if (pos && pos.shares >= trade.shares) {
              await db.run(`
                INSERT INTO trades
                  (portfolio_id, symbol, asset_type, trade_type, shares, price, total_value, ai_generated, reason, strategy_key)
                VALUES (?, ?, 'stock', 'sell', ?, ?, ?, 1, ?, ?)`,
                [portfolio.id, trade.symbol.toUpperCase(), trade.shares, price, total, trade.reason, portfolio.strategy_key]
              );
              const remaining = pos.shares - trade.shares;
              if (remaining <= 0) {
                await db.run('UPDATE positions SET is_open = 0, shares = 0 WHERE id = ?', [pos.id]);
              } else {
                await db.run('UPDATE positions SET shares = ? WHERE id = ?', [remaining, pos.id]);
              }
              await db.run(
                'UPDATE portfolios SET cash_balance = cash_balance + ? WHERE id = ?',
                [total, portfolio.id]
              );
            }
          }
        }
        console.log(`  ✅ AI trades processed for portfolio ${portfolio.id}`);
      } catch (portErr) {
        console.error(`  ❌ AI trade error for portfolio ${portfolio.id}:`, portErr.message);
      }
    }
    console.log('🤖 [CRON] AI trade simulation complete');
  } catch (err) {
    console.error('❌ [CRON] AI trade error:', err);
  }
}, { timezone: 'America/Toronto', scheduled: false });


// ── Start all jobs ────────────────────────────────────────────
function startAll() {
  dailyReportJob.start();
  priceUpdateJob.start();
  aiTradeJob.start();
  console.log('⏰ Cron jobs scheduled:');
  console.log('   📧 Daily reports   → 08:00 AM daily');
  console.log('   📈 Price updates   → Hourly (market hours, weekdays)');
  console.log('   🤖 AI trades       → 09:30 AM weekdays');
}

module.exports = { startAll, dailyReportJob, priceUpdateJob, aiTradeJob };
