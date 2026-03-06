/**
 * Stratiq — Database Seeder
 * Run: npm run seed
 *
 * Creates the SQLite schema and seeds:
 *   - Admin user
 *   - Demo user with sample portfolio + trades
 */

require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcryptjs');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'stratiq.db');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// ── Defaults ──────────────────────────────────────────────────
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@stratiq.io';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@Stratiq2025!';

// ── Open DB ───────────────────────────────────────────────────
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('DB Error:', err); process.exit(1); }
  console.log(`📂 Using database: ${DB_PATH}`);
});

db.serialize(async () => {
  try {
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');

    // ── Run schema ──────────────────────────────────────────
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      await run(db, stmt);
    }
    console.log('✅ Schema applied');

    // ── Admin user ──────────────────────────────────────────
    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const existingAdmin = await get(db,
      'SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL]);

    let adminId;
    if (!existingAdmin) {
      const res = await run(db, `
        INSERT INTO users (first_name, last_name, email, password_hash, role, plan, sim_budget, email_verified)
        VALUES (?, ?, ?, ?, 'admin', 'unlimited', 1000000, 1)`,
        ['Admin', 'Stratiq', ADMIN_EMAIL, adminHash]
      );
      adminId = res.lastID;
      console.log(`✅ Admin created → ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    } else {
      adminId = existingAdmin.id;
      console.log(`ℹ️  Admin already exists → ${ADMIN_EMAIL}`);
    }

    // Admin report prefs
    await run(db, `
      INSERT OR IGNORE INTO report_prefs (user_id) VALUES (?)`, [adminId]);

    // ── Demo user ────────────────────────────────────────────
    const demoEmail = 'demo@stratiq.io';
    const demoHash  = await bcrypt.hash('Demo@1234!', 12);
    const existingDemo = await get(db, 'SELECT id FROM users WHERE email = ?', [demoEmail]);

    let demoId;
    if (!existingDemo) {
      const res = await run(db, `
        INSERT INTO users (first_name, last_name, email, password_hash, role, plan, sim_budget, email_verified, report_email)
        VALUES (?, ?, ?, ?, 'user', 'pro', 100000, 1, ?)`,
        ['Demo', 'User', demoEmail, demoHash, demoEmail]
      );
      demoId = res.lastID;
      console.log(`✅ Demo user created → ${demoEmail} / Demo@1234!`);
    } else {
      demoId = existingDemo.id;
      console.log(`ℹ️  Demo user already exists`);
    }

    // Demo report prefs
    await run(db, `
      INSERT OR IGNORE INTO report_prefs
        (user_id, include_pnl, include_trades, include_ai_commentary, include_news, include_health)
      VALUES (?, 1, 1, 1, 1, 1)`, [demoId]);

    // Demo portfolio (Buffett strategy)
    const existingPort = await get(db,
      'SELECT id FROM portfolios WHERE user_id = ? AND is_default = 1', [demoId]);

    let portId;
    if (!existingPort) {
      const res = await run(db, `
        INSERT INTO portfolios
          (user_id, name, strategy_key, risk_level, rebalance_freq, ai_enabled,
           initial_budget, cash_balance, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [demoId, 'Buffett Portfolio', 'buffett', 'moderate', 'weekly', 1,
         100000, 8215, 1]
      );
      portId = res.lastID;
      console.log('✅ Demo portfolio created');
    } else {
      portId = existingPort.id;
    }

    // Demo positions
    const positions = [
      ['AAPL', 'Apple Inc.',             'stock',  85,  151.40, 189.30],
      ['BRK.B','Berkshire Hathaway B',   'stock',  42,  340.00, 378.90],
      ['KO',   'Coca-Cola Co.',          'stock', 200,   57.50,  62.40],
      ['JNJ',  'Johnson & Johnson',      'stock',  75,  159.00, 155.20],
      ['BAC',  'Bank of America',        'stock', 290,   34.40,  38.90],
      ['SPY',  'SPDR S&P 500 ETF',       'etf',    50,  490.00, 528.10],
      ['BTC',  'Bitcoin',                'crypto',  0.5, 58000,  67420],
    ];

    for (const [sym, name, type, shares, avg, cur] of positions) {
      await run(db, `
        INSERT OR IGNORE INTO positions
          (portfolio_id, symbol, name, asset_type, shares, avg_cost, current_price, last_price_update)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [portId, sym, name, type, shares, avg, cur]
      );
    }
    console.log('✅ Demo positions seeded');

    // Demo trades
    const trades = [
      ['AAPL','stock','buy',  10, 189.30, 'P/E expansion opportunity'],
      ['META','stock','sell',  5, 492.10, 'Exceeded valuation target'],
      ['KO',  'stock','buy',  50,  62.40, 'Dividend reinvestment + value'],
      ['BRK.B','stock','buy',  8, 376.00, 'Core position increase'],
    ];

    for (const [sym, type, ttype, shares, price, reason] of trades) {
      await run(db, `
        INSERT OR IGNORE INTO trades
          (portfolio_id, symbol, asset_type, trade_type, shares, price, total_value, ai_generated, reason, strategy_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'buffett')`,
        [portId, sym, type, ttype, shares, price, shares * price, reason]
      );
    }
    console.log('✅ Demo trades seeded');

    // Demo report
    await run(db, `
      INSERT OR IGNORE INTO daily_reports
        (user_id, portfolio_id, report_date, portfolio_value, daily_pnl, daily_pnl_pct, total_trades,
         ai_summary, email_sent)
      VALUES (?, ?, date('now'), 124385, 842, 0.68, 1,
        'Portfolio health is strong. Buffett-aligned positions are outperforming the S&P 500 by 3.2% this month. AAPL and KO are top contributors. No trades triggered today. Watchlist alert: BAC dipped below $39 — consider increasing allocation.',
        0)`,
      [demoId, portId]
    );
    console.log('✅ Demo report seeded');

    // ── Summary ────────────────────────────────────────────
    console.log('\n' + '─'.repeat(50));
    console.log('🚀 STRATIQ DATABASE READY');
    console.log('─'.repeat(50));
    console.log(`  Admin  → ${ADMIN_EMAIL}`);
    console.log(`  Pass   → ${ADMIN_PASSWORD}`);
    console.log(`  Demo   → demo@stratiq.io / Demo@1234!`);
    console.log('─'.repeat(50));
    console.log('  ⚠️  Change admin password after first login!\n');

    db.close();
    process.exit(0);

  } catch (err) {
    console.error('❌ Seed error:', err);
    db.close();
    process.exit(1);
  }
});

// ── Helpers ────────────────────────────────────────────────────
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}
