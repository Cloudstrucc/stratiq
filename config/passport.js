const passport       = require('passport');
const LocalStrategy  = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt         = require('bcryptjs');
const { get, run }   = require('../db/database');

// ── Serialize / Deserialize ───────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await get(
      'SELECT id, first_name, last_name, email, role, plan, sim_budget FROM users WHERE id = ? AND is_active = 1',
      [id]
    );
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

// ── Local Strategy ────────────────────────────────────────────
passport.use(new LocalStrategy(
  { usernameField: 'email', passReqToCallback: false },
  async (email, password, done) => {
    try {
      const user = await get(
        'SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1',
        [email.trim().toLowerCase()]
      );

      if (!user) {
        return done(null, false, { message: 'No account found with that email.' });
      }
      if (!user.password_hash) {
        return done(null, false, { message: 'This account uses Google Sign-In.' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return done(null, false, { message: 'Incorrect password.' });
      }

      // Update last login
      await run('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?', [user.id]);

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// ── Google OAuth Strategy ─────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email     = profile.emails?.[0]?.value?.toLowerCase();
        const firstName = profile.name?.givenName  || 'User';
        const lastName  = profile.name?.familyName || '';

        // Check if user exists
        let user = await get('SELECT * FROM users WHERE google_id = ? OR email = ?',
          [profile.id, email]);

        if (user) {
          // Link Google ID if missing
          if (!user.google_id) {
            await run('UPDATE users SET google_id = ? WHERE id = ?', [profile.id, user.id]);
          }
          await run('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?', [user.id]);
          return done(null, user);
        }

        // Create new user from Google
        const res = await run(`
          INSERT INTO users (first_name, last_name, email, google_id, role, plan, sim_budget, email_verified)
          VALUES (?, ?, ?, ?, 'user', 'free', 10000, 1)`,
          [firstName, lastName, email, profile.id]
        );

        // Create default portfolio
        await run(`
          INSERT INTO portfolios (user_id, name, strategy_key, initial_budget, cash_balance, is_default)
          VALUES (?, 'My Portfolio', 'manual', 10000, 10000, 1)`,
          [res.lastID]
        );

        // Default report prefs
        await run('INSERT INTO report_prefs (user_id) VALUES (?)', [res.lastID]);

        const newUser = await get('SELECT * FROM users WHERE id = ?', [res.lastID]);
        return done(null, newUser);
      } catch (err) {
        return done(err);
      }
    }
  ));
}

module.exports = passport;
