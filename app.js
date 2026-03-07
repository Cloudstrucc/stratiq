/**
 *  Stratiq — Main Application
 *  npm run seed   → initialise DB + admin account
 *  npm run dev    → start with nodemon
 *  npm start      → production start
 */

require('dotenv').config();

const path       = require('path');
const fs         = require('fs');

// ── Ensure DB directory exists BEFORE anything tries to open SQLite ───────────
// On Azure App Service only /home is persisted across restarts.
// DB_DIR defaults to /home/db in production, ./db in development.
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  console.log(`📁 Created DB directory: ${DB_DIR}`);
}

const express    = require('express');
const session    = require('express-session');
const flash      = require('connect-flash');
const passport   = require('./config/passport');
const hbs        = require('express-handlebars');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const SQLiteStore = require('connect-sqlite3')(session);

const { setLocals }   = require('./middleware/auth');
const { STRATEGIES }  = require('./services/aiService');

// ── Create app ────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// Trust first proxy (Azure App Service reverse proxy)
// Required for express-rate-limit to receive a clean IP address
app.set('trust proxy', 1);

// ── Security headers ─────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      imgSrc:     ["'self'", "data:", "https:"],
      fontSrc:    ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
      connectSrc:    ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
}));

// ── Rate limiters ────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.flash('error', 'Too many requests. Please wait a few minutes and try again.');
    res.status(429).redirect('back');
  },
});

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Rate limit exceeded. Please wait before making more AI requests.' });
  },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.flash('error', 'Too many requests. Please wait a few minutes and try again.');
    res.status(429).redirect('back');
  },
});

// ── Template engine ───────────────────────────────────────────
const hbsEngine = hbs.create({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir:  path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    // Equality check
    eq:  (a, b) => a == b,
    neq: (a, b) => a != b,
    gt:  (a, b) => parseFloat(a) > parseFloat(b),
    lt:  (a, b) => parseFloat(a) < parseFloat(b),

    // Math helpers
    multiply: (a, b) => (parseFloat(a) * parseFloat(b)) || 0,
    subtract: (a, b) => (parseFloat(a) - parseFloat(b)) || 0,

    // Formatting
    formatNumber: (n) => {
      const num = parseFloat(n) || 0;
      return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    },
    formatDecimal: (n) => {
      const num = parseFloat(n) || 0;
      return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    formatPct: (n) => {
      const num = parseFloat(n) || 0;
      return (num >= 0 ? '+' : '') + num.toFixed(2);
    },
    formatDate: (d) => {
      if (!d) return '—';
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    cashPct: (cash, budget) => {
      if (!budget) return 0;
      return ((parseFloat(cash) / parseFloat(budget)) * 100).toFixed(1);
    },

    // JSON for templates
    json: (obj) => JSON.stringify(obj),
  }
});

app.engine('.hbs', hbsEngine.engine);
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, 'views'));

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session — store in DB_DIR so it survives restarts on Azure
app.use(session({
  store:  new SQLiteStore({ db: 'sessions.db', dir: DB_DIR }),
  secret: process.env.SESSION_SECRET || 'stratiq-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
  name: 'stratiq.sid',
}));

// Auth
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use(setLocals);

// ── Routes ────────────────────────────────────────────────────
app.use('/auth',      authLimiter,    require('./routes/auth'));
app.use('/dashboard',                 require('./routes/dashboard'));
app.use('/portfolio', generalLimiter, require('./routes/portfolio'));
app.use('/ai',        aiLimiter,      require('./routes/ai'));
app.use('/admin',     generalLimiter, require('./routes/admin'));

// Landing page
app.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('index', { layout: 'main', title: 'Stratiq — Simulate. Strategize. Grow.' });
});

// Pricing page
app.get('/pricing', (req, res) => {
  res.render('pricing', { layout: 'main', title: 'Pricing — Stratiq' });
});

// ── Strategy data for AI strategy page ───────────────────────
app.use((req, res, next) => {
  res.locals.strategies = Object.entries(STRATEGIES).map(([key, val]) => ({
    key,
    name: val.name,
    desc: (val.system.split('\n')[1] || '').replace('Rules:','').trim().slice(0, 50),
    risk: key === 'buffett' || key === 'dalio' || key === 'dca_index' ? 'Low'
        : key === 'lynch'   ? 'Medium'
        : 'High',
    riskClass: key === 'buffett' || key === 'dalio' || key === 'dca_index' ? 'low'
             : key === 'lynch' ? 'med' : 'high',
  }));
  next();
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).render('index', {
    layout: 'main',
    title: 'Page Not Found — Stratiq',
  });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  const userId = req.user?.id || 'anonymous';
  console.error(`[ERROR] ${req.method} ${req.originalUrl} | user=${userId} |`, err.stack || err);

  const status = err.status || err.statusCode || 500;

  const wantsJson = req.xhr
    || (req.headers.accept && req.headers.accept.includes('application/json'))
    || req.path.startsWith('/ai');

  if (wantsJson) {
    return res.status(status).json({
      error: status === 500
        ? 'Internal server error. Please try again.'
        : err.message || 'An error occurred.',
    });
  }

  if (req.flash) {
    req.flash('error', 'Something went wrong. Please try again.');
  }
  res.status(status).redirect(req.isAuthenticated() ? '/dashboard' : '/');
});

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n' + '─'.repeat(50));
  console.log(`🚀 Stratiq running → http://localhost:${PORT}`);
  console.log(`📋 Environment    → ${process.env.NODE_ENV || 'development'}`);
  console.log('─'.repeat(50) + '\n');

  // Start cron jobs
  if (process.env.NODE_ENV !== 'test') {
    require('./jobs/dailyReport').startAll();
  }
});

module.exports = app;