const express  = require('express');
const passport = require('passport');
const bcrypt   = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { run, get }     = require('../db/database');
const { guestOnly }    = require('../middleware/auth');
const { sendWelcome }  = require('../services/emailService');

const router = express.Router();

// ── GET /auth/login ───────────────────────────────────────────
router.get('/login', guestOnly, (req, res) => {
  res.render('auth/login', { layout: 'main', title: 'Sign In — Stratiq' });
});

// ── POST /auth/login ──────────────────────────────────────────
router.post('/login',
  guestOnly,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array()[0].msg);
      return res.redirect('/auth/login');
    }
    passport.authenticate('local', (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        req.flash('error', info?.message || 'Invalid credentials.');
        return res.redirect('/auth/login');
      }
      req.logIn(user, (err) => {
        if (err) return next(err);
        req.flash('success', `Welcome back, ${user.first_name}!`);
        const redirect = req.session.returnTo || '/dashboard';
        delete req.session.returnTo;
        res.redirect(user.role === 'admin' ? '/admin' : redirect);
      });
    })(req, res, next);
  }
);

// ── GET /auth/register ────────────────────────────────────────
router.get('/register', guestOnly, (req, res) => {
  res.render('auth/register', { layout: 'main', title: 'Create Account — Stratiq' });
});

// ── POST /auth/register ───────────────────────────────────────
router.post('/register',
  guestOnly,
  [
    body('first_name').trim().notEmpty().withMessage('First name required'),
    body('last_name').trim().notEmpty().withMessage('Last name required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('sim_budget').isFloat({ min: 1000 }).withMessage('Minimum budget is $1,000'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array()[0].msg);
      return res.redirect('/auth/register');
    }

    const { first_name, last_name, email, password, sim_budget, strategy_key } = req.body;

    try {
      const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        req.flash('error', 'An account with that email already exists.');
        return res.redirect('/auth/register');
      }

      const hash = await bcrypt.hash(password, 12);
      const budget = parseFloat(sim_budget) || 10000;

      const userRes = await run(`
        INSERT INTO users (first_name, last_name, email, password_hash, role, plan, sim_budget, report_email)
        VALUES (?, ?, ?, ?, 'user', 'free', ?, ?)`,
        [first_name, last_name, email, hash, budget, email]
      );
      const userId = userRes.lastID;

      // Default portfolio
      await run(`
        INSERT INTO portfolios (user_id, name, strategy_key, initial_budget, cash_balance, is_default)
        VALUES (?, ?, ?, ?, ?, 1)`,
        [userId, 'My Portfolio', strategy_key || 'manual', budget, budget]
      );

      // Default report prefs
      await run('INSERT INTO report_prefs (user_id) VALUES (?)', [userId]);

      // Send welcome email (non-blocking)
      const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
      sendWelcome(user).catch(() => {});

      // Auto-login
      req.logIn(user, (err) => {
        if (err) { req.flash('error', 'Account created. Please sign in.'); return res.redirect('/auth/login'); }
        req.flash('success', `Welcome to Stratiq, ${first_name}!`);
        res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('Register error:', err);
      req.flash('error', 'Registration failed. Please try again.');
      res.redirect('/auth/register');
    }
  }
);

// ── Google OAuth ──────────────────────────────────────────────
router.get('/google', guestOnly, passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/login', failureFlash: true }),
  (req, res) => {
    req.flash('success', `Welcome, ${req.user.first_name}!`);
    res.redirect('/dashboard');
  }
);

// ── Logout ────────────────────────────────────────────────────
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success', 'You have been signed out.');
    res.redirect('/');
  });
});

module.exports = router;
