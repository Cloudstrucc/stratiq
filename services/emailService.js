/**
 * Stratiq Email Service
 * Handles transactional emails via Nodemailer
 */

const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST   || 'smtp.mailtrap.io',
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Stratiq'}" <${process.env.EMAIL_FROM || 'noreply@stratiq.io'}>`;

// ── Daily Report Email ────────────────────────────────────────
async function sendDailyReport(user, report, portfolio, positions) {
  const totalValue = portfolio.cash_balance +
    positions.reduce((s, p) => s + p.current_price * p.shares, 0);
  const pnlSign  = report.daily_pnl >= 0 ? '+' : '';
  const pnlColor = report.daily_pnl >= 0 ? '#22c55e' : '#ef4444';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Stratiq Daily Report</title>
</head>
<body style="margin:0;padding:0;background:#0a0d12;font-family:'DM Sans',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <span style="font-size:1.8rem;font-weight:800;color:#f0f4ff;letter-spacing:-.02em;">
        Strat<span style="color:#22c55e;">iq</span>
      </span>
      <p style="color:#7c8ba1;font-size:.85rem;margin:4px 0 0;">Daily Portfolio Report · ${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
    </div>

    <!-- Greeting -->
    <p style="color:#f0f4ff;font-size:1rem;margin-bottom:24px;">
      Hi ${user.first_name}, here's your Stratiq simulation summary for today.
    </p>

    <!-- Stats Row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
      <div style="background:#111620;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:20px;">
        <div style="color:#7c8ba1;font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Portfolio Value</div>
        <div style="color:#f0f4ff;font-size:1.6rem;font-weight:800;">$${totalValue.toLocaleString('en-US', {maximumFractionDigits:0})}</div>
      </div>
      <div style="background:#111620;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:20px;">
        <div style="color:#7c8ba1;font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Today's P&L</div>
        <div style="color:${pnlColor};font-size:1.6rem;font-weight:800;">${pnlSign}$${Math.abs(report.daily_pnl).toLocaleString('en-US', {maximumFractionDigits:0})}</div>
      </div>
    </div>

    <!-- AI Summary -->
    <div style="background:#111620;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:24px;margin-bottom:24px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <span style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.2);border-radius:20px;padding:4px 12px;color:#22c55e;font-size:.75rem;font-weight:700;">✦ AI SUMMARY</span>
      </div>
      <p style="color:#b0bace;font-size:.9rem;line-height:1.7;margin:0;">${report.ai_summary || 'No summary available.'}</p>
    </div>

    <!-- Top Positions -->
    <div style="background:#111620;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:24px;margin-bottom:24px;">
      <div style="color:#f0f4ff;font-weight:700;font-size:.95rem;margin-bottom:16px;">Top Positions</div>
      ${positions.slice(0, 5).map(p => {
        const pnl     = (p.current_price - p.avg_cost) * p.shares;
        const pnlPct  = ((p.current_price - p.avg_cost) / p.avg_cost * 100).toFixed(1);
        const color   = pnl >= 0 ? '#22c55e' : '#ef4444';
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05);">
          <div>
            <span style="color:#f0f4ff;font-weight:700;font-size:.9rem;">${p.symbol}</span>
            <span style="color:#7c8ba1;font-size:.8rem;margin-left:8px;">${p.name || ''}</span>
          </div>
          <span style="color:${color};font-size:.85rem;font-weight:600;">${pnl >= 0 ? '+' : ''}${pnlPct}%</span>
        </div>`;
      }).join('')}
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:32px;">
      <a href="${process.env.APP_URL}/dashboard" style="background:#22c55e;color:#fff;text-decoration:none;border-radius:30px;padding:12px 28px;font-weight:700;font-size:.95rem;display:inline-block;">
        View Full Dashboard →
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;color:#3f4d65;font-size:.78rem;border-top:1px solid rgba(255,255,255,.05);padding-top:20px;">
      <p>Stratiq · Simulated Portfolio · Not Financial Advice</p>
      <p><a href="${process.env.APP_URL}/dashboard/settings" style="color:#3f4d65;">Manage email preferences</a></p>
    </div>

  </div>
</body>
</html>`;

  try {
    await getTransporter().sendMail({
      from:    FROM,
      to:      user.report_email || user.email,
      subject: `📊 Your Stratiq Daily Report — ${pnlSign}${report.daily_pnl_pct?.toFixed(2) || 0}% today`,
      html,
    });
    return true;
  } catch (err) {
    console.error(`Email send error for user ${user.id}:`, err.message);
    return false;
  }
}

// ── Welcome Email ─────────────────────────────────────────────
async function sendWelcome(user) {
  const html = `
<div style="max-width:500px;margin:0 auto;padding:32px;font-family:Arial,sans-serif;background:#0a0d12;color:#f0f4ff;">
  <h1 style="font-size:1.8rem;font-weight:800;">Welcome to Strat<span style="color:#22c55e;">iq</span>, ${user.first_name}!</h1>
  <p style="color:#7c8ba1;">Your simulated investment portfolio is ready. Start exploring strategies and let AI guide your first trades.</p>
  <a href="${process.env.APP_URL}/dashboard" style="background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;padding:12px 24px;display:inline-block;margin-top:16px;font-weight:700;">Go to Dashboard →</a>
  <p style="color:#3f4d65;font-size:.8rem;margin-top:32px;">Stratiq · For simulation purposes only. Not financial advice.</p>
</div>`;

  try {
    await getTransporter().sendMail({
      from:    FROM,
      to:      user.email,
      subject: `Welcome to Stratiq, ${user.first_name}! 🚀`,
      html,
    });
    return true;
  } catch (err) {
    console.error('Welcome email error:', err.message);
    return false;
  }
}

// ── Password Reset (stub for future) ─────────────────────────
async function sendPasswordReset(user, token) {
  const resetUrl = `${process.env.APP_URL}/auth/reset-password/${token}`;
  const html = `
<div style="max-width:500px;margin:0 auto;padding:32px;font-family:Arial,sans-serif;background:#0a0d12;color:#f0f4ff;">
  <h2 style="font-weight:800;">Reset your password</h2>
  <p style="color:#7c8ba1;">Click below to reset your Stratiq password. Link expires in 1 hour.</p>
  <a href="${resetUrl}" style="background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;padding:12px 24px;display:inline-block;margin-top:16px;font-weight:700;">Reset Password</a>
  <p style="color:#3f4d65;font-size:.8rem;margin-top:32px;">If you didn't request this, ignore this email.</p>
</div>`;

  try {
    await getTransporter().sendMail({
      from:    FROM,
      to:      user.email,
      subject: 'Stratiq — Password Reset Request',
      html,
    });
    return true;
  } catch (err) {
    console.error('Password reset email error:', err.message);
    return false;
  }
}

module.exports = { sendDailyReport, sendWelcome, sendPasswordReset };
