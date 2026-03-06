# Stratiq — AI Investment Strategy Simulator

> Simulate real investment strategies with zero risk. Let Claude AI execute trades, generate daily reports, and guide your portfolio.

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/you/stratiq.git
cd stratiq
npm install
```

### 2. Environment Setup
```bash
cp .env.example .env
# Edit .env — add your Anthropic API key, SMTP config, etc.
```

### 3. Seed Database
```bash
npm run seed
```
This creates:
- **Admin account**: `admin@stratiq.io` / `Admin@Stratiq2025!`
- **Demo account**: `demo@stratiq.io` / `Demo@1234!`
- Sample portfolio with positions and trades

> ⚠️ Change the admin password immediately after first login!

### 4. Start the App
```bash
npm run dev    # development (nodemon auto-restart)
npm start      # production
```

Open → **http://localhost:3000**

---

## 📁 Project Structure

```
stratiq/
├── app.js                  # Express entry point
├── package.json
├── .env.example            # Environment variable template
├── .gitignore
│
├── db/
│   ├── schema.sql          # SQLite table definitions
│   ├── database.js         # DB connection + helpers
│   └── seed.js             # Admin + demo data seeder
│
├── config/
│   └── passport.js         # Passport local + Google OAuth
│
├── middleware/
│   └── auth.js             # requireAuth, requireAdmin, guestOnly
│
├── routes/
│   ├── auth.js             # /auth/login, register, logout, google
│   ├── dashboard.js        # /dashboard/* views
│   ├── portfolio.js        # /portfolio/* CRUD + trading
│   ├── ai.js               # /ai/chat, simulate, history
│   └── admin.js            # /admin user management
│
├── services/
│   ├── aiService.js        # Anthropic Claude integration
│   ├── emailService.js     # Nodemailer transactional emails
│   └── marketData.js       # Price fetching + mock data
│
├── jobs/
│   └── dailyReport.js      # node-cron: reports, prices, AI trades
│
├── views/
│   ├── layouts/
│   │   ├── main.hbs        # Public layout
│   │   └── dashboard.hbs   # Authenticated layout
│   ├── auth/               # login.hbs, register.hbs
│   ├── dashboard/          # overview, portfolio, ai-strategy, trades, reports, settings
│   └── admin/              # admin dashboard
│
└── public/
    ├── css/stratiq.css     # All styles (dark/light mode)
    └── js/
        ├── theme.js        # Theme toggle + persistence
        └── dashboard.js    # Chart helpers
```

---

## 🔑 Default Accounts

| Role  | Email                 | Password           |
|-------|-----------------------|--------------------|
| Admin | admin@stratiq.io      | Admin@Stratiq2025! |
| Demo  | demo@stratiq.io       | Demo@1234!         |

**Admin dashboard** → http://localhost:3000/admin

---

## 🛠️ Key Dependencies

| Package              | Purpose                          |
|----------------------|----------------------------------|
| express              | Web framework                    |
| express-handlebars   | Template engine                  |
| passport / passport-local | Authentication            |
| passport-google-oauth20 | Google Sign-In               |
| sqlite3 + connect-sqlite3 | Database + session store   |
| bcryptjs             | Password hashing                 |
| @anthropic-ai/sdk    | Claude AI integration            |
| nodemailer           | Email sending                    |
| node-cron            | Scheduled jobs                   |
| express-validator    | Input validation                 |
| connect-flash        | Flash messages                   |

---

## ⏰ Scheduled Jobs

| Job           | Schedule              | Action                              |
|---------------|-----------------------|-------------------------------------|
| Daily Reports | 08:00 AM daily        | Generate AI summary + send emails   |
| Price Updates | Hourly (market hours) | Refresh portfolio position prices   |
| AI Trades     | 09:30 AM weekdays     | Execute AI strategy trade decisions |

---

## 🌍 Environment Variables

See `.env.example` for full list. Key variables:

```env
ANTHROPIC_API_KEY=sk-ant-...     # Required for AI features
SMTP_HOST=smtp.mailtrap.io       # Email sending
SESSION_SECRET=...               # Long random string
GOOGLE_CLIENT_ID=...             # Optional Google OAuth
ALPHA_VANTAGE_KEY=...            # Optional real market data
```

---

## 📊 Investment Strategies

| Strategy        | Style              | Risk     |
|-----------------|--------------------|----------|
| Warren Buffett  | Value investing    | Low      |
| Ray Dalio       | All Weather        | Low      |
| DCA Index       | S&P 500 passive    | Low      |
| Peter Lynch     | GARP               | Medium   |
| Cathie Wood     | Disruptive tech    | High     |
| Jesse Livermore | Momentum trading   | High     |
| Manual          | Build your own     | Varies   |
| Custom Prompt   | Describe in text   | Varies   |

---

## 🚀 Production Deployment

1. Set `NODE_ENV=production` in `.env`
2. Set a strong `SESSION_SECRET`
3. Use a process manager: `pm2 start app.js --name stratiq`
4. Reverse proxy with nginx
5. Consider upgrading to PostgreSQL for scale

---

*Stratiq is for educational simulation only. Not financial advice.*
