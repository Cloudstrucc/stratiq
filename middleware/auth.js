/**
 * Auth & Role Middleware
 */

// Require logged-in user
exports.requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Please sign in to access that page.');
  res.redirect('/auth/login');
};

// Require admin role
exports.requireAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  if (!req.isAuthenticated()) {
    req.flash('error', 'Please sign in.');
    return res.redirect('/auth/login');
  }
  req.flash('error', 'Access denied — admin only.');
  res.redirect('/dashboard');
};

// Require specific plan (or higher)
const PLAN_RANK = { free: 0, pro: 1, unlimited: 2 };
exports.requirePlan = (minPlan) => (req, res, next) => {
  const userRank  = PLAN_RANK[req.user?.plan] ?? 0;
  const minRank   = PLAN_RANK[minPlan] ?? 0;
  // Admins bypass plan checks
  if (req.user?.role === 'admin' || userRank >= minRank) return next();
  req.flash('error', `This feature requires the ${minPlan} plan. Please upgrade.`);
  res.redirect('/dashboard/settings?tab=plan');
};

// Redirect logged-in users away from auth pages
exports.guestOnly = (req, res, next) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  next();
};

// Attach locals for all views
exports.setLocals = (req, res, next) => {
  res.locals.user      = req.user || null;
  res.locals.isAdmin   = req.user?.role === 'admin';
  res.locals.flashSuccess = req.flash('success');
  res.locals.flashError   = req.flash('error');
  res.locals.flashInfo    = req.flash('info');
  next();
};
