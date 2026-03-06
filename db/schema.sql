-- ─────────────────────────────────────────────
--  STRATIQ Database Schema
--  SQLite — run via seed.js or manually:
--    sqlite3 db/stratiq.db < db/schema.sql
-- ─────────────────────────────────────────────

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ─── Users ────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name      TEXT    NOT NULL,
  last_name       TEXT    NOT NULL,
  email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT,                          -- null for OAuth users
  google_id       TEXT    UNIQUE,
  role            TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  plan            TEXT    NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro','unlimited')),
  sim_budget      REAL    NOT NULL DEFAULT 10000,
  timezone        TEXT    NOT NULL DEFAULT 'America/Toronto',
  currency        TEXT    NOT NULL DEFAULT 'USD',
  report_email    TEXT,
  report_freq     TEXT    NOT NULL DEFAULT 'daily' CHECK(report_freq IN ('daily','weekdays','weekly','never')),
  report_time     TEXT    NOT NULL DEFAULT '08:00',
  is_active       INTEGER NOT NULL DEFAULT 1,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT
);

-- ─── Report Preferences ───────────────────────
CREATE TABLE IF NOT EXISTS report_prefs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  include_pnl     INTEGER NOT NULL DEFAULT 1,
  include_trades  INTEGER NOT NULL DEFAULT 1,
  include_ai_commentary INTEGER NOT NULL DEFAULT 1,
  include_news    INTEGER NOT NULL DEFAULT 1,
  include_positions INTEGER NOT NULL DEFAULT 0,
  include_health  INTEGER NOT NULL DEFAULT 1
);

-- ─── Portfolios ───────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL DEFAULT 'My Portfolio',
  description     TEXT,
  strategy_key    TEXT    DEFAULT 'manual',      -- 'manual','buffett','dalio','lynch', etc.
  strategy_prompt TEXT,                          -- custom free-form strategy
  risk_level      TEXT    NOT NULL DEFAULT 'moderate' CHECK(risk_level IN ('conservative','moderate','aggressive','speculative')),
  rebalance_freq  TEXT    NOT NULL DEFAULT 'weekly',
  ai_enabled      INTEGER NOT NULL DEFAULT 0,
  initial_budget  REAL    NOT NULL DEFAULT 10000,
  cash_balance    REAL    NOT NULL DEFAULT 10000,
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── Positions ────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id    INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol          TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT,
  asset_type      TEXT    NOT NULL DEFAULT 'stock' CHECK(asset_type IN ('stock','etf','crypto','bond','other')),
  shares          REAL    NOT NULL DEFAULT 0,
  avg_cost        REAL    NOT NULL DEFAULT 0,
  current_price   REAL    NOT NULL DEFAULT 0,
  last_price_update TEXT,
  is_open         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(portfolio_id, symbol)
);

-- ─── Trades ───────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id    INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol          TEXT    NOT NULL COLLATE NOCASE,
  asset_type      TEXT    NOT NULL DEFAULT 'stock',
  trade_type      TEXT    NOT NULL CHECK(trade_type IN ('buy','sell','hold')),
  shares          REAL    NOT NULL DEFAULT 0,
  price           REAL    NOT NULL DEFAULT 0,
  total_value     REAL    NOT NULL DEFAULT 0,
  ai_generated    INTEGER NOT NULL DEFAULT 0,
  reason          TEXT,
  strategy_key    TEXT,
  executed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── Daily Reports ────────────────────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id    INTEGER REFERENCES portfolios(id) ON DELETE SET NULL,
  report_date     TEXT    NOT NULL,
  portfolio_value REAL,
  daily_pnl       REAL,
  daily_pnl_pct   REAL,
  total_trades    INTEGER DEFAULT 0,
  ai_summary      TEXT,
  email_sent      INTEGER NOT NULL DEFAULT 0,
  email_sent_at   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── Watchlist ────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol          TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT,
  asset_type      TEXT    NOT NULL DEFAULT 'stock',
  alert_price     REAL,
  alert_direction TEXT    CHECK(alert_direction IN ('above','below')),
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, symbol)
);

-- ─── AI Conversations ─────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id    INTEGER REFERENCES portfolios(id) ON DELETE SET NULL,
  role            TEXT    NOT NULL CHECK(role IN ('user','assistant')),
  content         TEXT    NOT NULL,
  tokens_used     INTEGER DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── Sessions (handled by connect-sqlite3 automatically)

-- ─── Indexes ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_positions_portfolio  ON positions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_trades_portfolio      ON trades(portfolio_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_reports_user_date     ON daily_reports(user_id, report_date);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user          ON ai_conversations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_watchlist_user        ON watchlist(user_id);
