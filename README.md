# Stratiq — AI Investment Strategy Simulator

> Simulate real investment strategies with zero risk. Let Claude AI execute trades, generate daily reports, and guide your portfolio.

---

## Contents

- [Stratiq — AI Investment Strategy Simulator](#stratiq--ai-investment-strategy-simulator)
  - [Contents](#contents)
  - [🚀 Local Development](#-local-development)
    - [1. Clone \& Install](#1-clone--install)
    - [2. Environment Setup](#2-environment-setup)
    - [3. Seed Database](#3-seed-database)
    - [4. Start](#4-start)
  - [📁 Project Structure](#-project-structure)
  - [🔑 Default Accounts](#-default-accounts)
  - [🌍 Environment Variables](#-environment-variables)
  - [☁️ Deploy to Azure App Service](#️-deploy-to-azure-app-service)
    - [Prerequisites](#prerequisites)
    - [One-Command Deploy](#one-command-deploy)
    - [Override Defaults](#override-defaults)
    - [Seed the Database (First Deploy Only)](#seed-the-database-first-deploy-only)
    - [SQLite Persistence on Azure](#sqlite-persistence-on-azure)
    - [Redeploying After Code Changes](#redeploying-after-code-changes)
    - [Useful Azure Commands](#useful-azure-commands)
    - [SKU Reference](#sku-reference)
  - [⏰ Scheduled Jobs](#-scheduled-jobs)
  - [📊 Investment Strategies](#-investment-strategies)
  - [🛠️ Key Dependencies](#️-key-dependencies)

---

## 🚀 Local Development

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
- **Admin account** → `admin@stratiq.io` / `Admin@Stratiq2025!`
- **Demo account** → `demo@stratiq.io` / `Demo@1234!`
- Sample portfolio with positions and trade history

> ⚠️ Change the admin password immediately after first login!

### 4. Start
```bash
npm run dev    # development — nodemon auto-restart
npm start      # production
```

Open → **http://localhost:3000**

---

## 📁 Project Structure

```
stratiq/
├── app.js                  # Express entry point + cron scheduler
├── package.json
├── .env.example            # All environment variables documented
├── .gitignore
├── deploy-azure.sh         # One-command Azure App Service deploy
│
├── db/
│   ├── schema.sql          # SQLite table definitions (7 tables)
│   ├── database.js         # DB connection + promisified helpers
│   └── seed.js             # Admin + demo data seeder
│
├── config/
│   └── passport.js         # Passport local + Google OAuth strategies
│
├── middleware/
│   └── auth.js             # requireAuth, requireAdmin, requirePlan, guestOnly
│
├── routes/
│   ├── auth.js             # /auth/login, register, logout, google
│   ├── dashboard.js        # /dashboard/* views
│   ├── portfolio.js        # /portfolio/* CRUD + trade execution
│   ├── ai.js               # /ai/chat, simulate, history
│   └── admin.js            # /admin user management
│
├── services/
│   ├── aiService.js        # Anthropic Claude — strategy sim, trades, summaries
│   ├── emailService.js     # Nodemailer — daily reports, welcome, reset
│   └── marketData.js       # Alpha Vantage prices + mock fallback
│
├── jobs/
│   └── dailyReport.js      # node-cron: 3 scheduled jobs
│
├── views/
│   ├── layouts/
│   │   ├── main.hbs        # Public layout (nav, flash, footer)
│   │   └── dashboard.hbs   # Authenticated layout (sidebar, topbar)
│   ├── auth/               # login.hbs, register.hbs
│   ├── dashboard/          # overview, portfolio, ai-strategy, trades, reports, settings
│   ├── admin/              # admin dashboard
│   ├── index.hbs           # Landing page
│   └── pricing.hbs         # Pricing page
│
└── public/
    ├── css/stratiq.css     # Full dark/light CSS system
    └── js/
        ├── theme.js        # Theme toggle + localStorage persistence
        └── dashboard.js    # Chart theme sync on toggle
```

---

## 🔑 Default Accounts

| Role  | Email              | Password           |
|-------|--------------------|--------------------|
| Admin | admin@stratiq.io   | Admin@Stratiq2025! |
| Demo  | demo@stratiq.io    | Demo@1234!         |

Admin panel → `/admin`

> Credentials are set in `.env` via `ADMIN_EMAIL` and `ADMIN_PASSWORD` before running `npm run seed`.

---

## 🌍 Environment Variables

Copy `.env.example` to `.env` and fill in your values. Key variables:

```env
# App
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
SESSION_SECRET=replace_with_long_random_string

# Database
DB_PATH=./db/stratiq.db

# Anthropic AI (required for AI features)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Email / SMTP (required for daily reports)
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=your_user
SMTP_PASS=your_pass
EMAIL_FROM=noreply@stratiq.io

# Google OAuth (optional)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Market Data (optional — mock data used if absent)
ALPHA_VANTAGE_KEY=...

# Admin seed defaults
ADMIN_EMAIL=admin@stratiq.io
ADMIN_PASSWORD=Admin@Stratiq2025!
```

See `.env.example` for the full annotated list.

---

## ☁️ Deploy to Azure App Service

A single script handles the full deployment — resource group, App Service plan, web app
creation, environment variable sync from your local `.env`, and a health check at the end.

### Prerequisites

```bash
# Install Azure CLI
brew install azure-cli                  # macOS
# Windows: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli

# Log in to your Azure tenant
az login

# Install zip if not present
brew install zip                        # macOS
sudo apt install zip                    # Ubuntu/Debian
```

### One-Command Deploy

```bash
chmod +x deploy-azure.sh
./deploy-azure.sh
```

The script will:

1. **Auto-detect a valid Node.js runtime** by calling `az webapp list-runtimes --os-type linux`
   against your actual subscription — avoids the "runtime not supported" error caused by
   hardcoded version strings that differ across Azure regions
2. **Show the deployment plan** and prompt for confirmation before creating any resources
3. **Validate your `.env`** — warns if `ANTHROPIC_API_KEY`, `SMTP_HOST`, `SMTP_USER`, or
   `SMTP_PASS` are missing or still placeholder values, and lets you abort cleanly
4. **Create** resource group → Linux App Service plan → Web App
5. **Enable Always On** (B1+) so the three cron jobs stay alive around the clock
6. **Sync all environment variables** from your local `.env` directly to Azure App Settings —
   secrets never touch source control
7. **Deploy** the zipped app (node_modules, .env, and *.db files are excluded automatically)
8. **Run a health check** polling the live URL up to 24 times before reporting success

### Override Defaults

All configuration can be overridden with environment variables before running the script:

```bash
# Custom app name and region
APP_NAME=my-stratiq REGION=eastus ./deploy-azure.sh

# Specify Node runtime manually (if auto-detect picks wrong version)
NODE_VERSION="NODE:20-lts" ./deploy-azure.sh

# Larger SKU for production
SKU=B2 ./deploy-azure.sh

# Combine overrides
APP_NAME=stratiq-prod REGION=canadaeast SKU=P1v3 ./deploy-azure.sh
```

If you are unsure what runtime strings are valid in your subscription, run:

```bash
az webapp list-runtimes --os-type linux
```

### Seed the Database (First Deploy Only)

After the first deploy, SSH into the container to initialise the database and create accounts:

```bash
az webapp ssh --name <your-app-name> --resource-group stratiq-rg

# Inside the SSH session:
cd /home/site/wwwroot
npm run seed
```

This creates the admin and demo accounts in the remote SQLite database using the
`ADMIN_EMAIL` and `ADMIN_PASSWORD` values from Azure App Settings.

### SQLite Persistence on Azure

The database is stored at `/home/data/stratiq.db`. Azure App Service mounts `/home` as a
persistent shared volume — it survives restarts, redeployments, and container recycles.

Redeploys using the script exclude `db/*.db` files, so your production data is never
overwritten by a fresh deploy.

> For production at scale, migrate to **Azure Database for PostgreSQL Flexible Server** or
> **Azure SQL**. The schema in `db/schema.sql` maps cleanly to either with minor type changes.

### Redeploying After Code Changes

Simply run the script again from the project root:

```bash
./deploy-azure.sh
```

It detects the existing resource group, plan, and app, skips creation steps, syncs any
updated `.env` keys, deploys the new code, and restarts the app.

### Useful Azure Commands

```bash
# Stream live application logs
az webapp log tail --name <app-name> --resource-group stratiq-rg

# SSH into the running container
az webapp ssh --name <app-name> --resource-group stratiq-rg

# Update a single environment variable (e.g. rotate API key)
az webapp config appsettings set \
  --name <app-name> \
  --resource-group stratiq-rg \
  --settings ANTHROPIC_API_KEY=sk-ant-...

# View all current App Settings
az webapp config appsettings list \
  --name <app-name> \
  --resource-group stratiq-rg \
  --output table

# List valid Node.js runtimes for your subscription
az webapp list-runtimes --os-type linux

# Open the Azure Portal blade for the app
# https://portal.azure.com/#resource/subscriptions/<sub-id>/resourceGroups/stratiq-rg/providers/Microsoft.Web/sites/<app-name>

# Tear down all resources
az group delete --name stratiq-rg --yes --no-wait
```

### SKU Reference

| SKU  | Cost (approx.) | Always On | Custom Domain | Recommended for        |
|------|----------------|-----------|---------------|------------------------|
| F1   | Free           | No        | No            | Smoke testing only     |
| B1   | ~$13/mo        | Yes       | Yes           | Dev / low traffic      |
| B2   | ~$27/mo        | Yes       | Yes           | Production             |
| P1v3 | ~$80/mo        | Yes       | Yes           | Scale / high traffic   |

> **Always On must be enabled** for the scheduled cron jobs (daily email reports, AI trade
> execution, price updates) to run reliably. The F1 free tier sleeps after inactivity and
> will miss scheduled jobs — use B1 as the minimum for any real usage.

---

## ⏰ Scheduled Jobs

All jobs are managed by `node-cron` in `jobs/dailyReport.js` and start automatically when
the app boots. Always On (B1+) is required for reliable execution.

| Job           | Schedule                    | Action                                       |
|---------------|-----------------------------|----------------------------------------------|
| Daily Reports | 08:00 AM daily (ET)         | Generate AI portfolio summary + send emails  |
| Price Updates | Hourly, weekdays 9 AM–4 PM  | Refresh all portfolio position prices        |
| AI Trades     | 09:30 AM weekdays           | Execute AI strategy decisions (Pro+ users)   |

---

## 📊 Investment Strategies

| Strategy        | Style                  | Risk    |
|-----------------|------------------------|---------|
| Warren Buffett  | Value investing        | Low     |
| Ray Dalio       | All Weather            | Low     |
| DCA Index       | S&P 500 passive DCA    | Low     |
| Peter Lynch     | GARP                   | Medium  |
| Cathie Wood     | Disruptive tech        | High    |
| Jesse Livermore | Momentum / trend       | High    |
| Manual          | Build your own         | Varies  |
| Custom Prompt   | Freeform text strategy | Varies  |

---

## 🛠️ Key Dependencies

| Package                   | Purpose                            |
|---------------------------|------------------------------------|
| express                   | Web framework                      |
| express-handlebars        | Server-side templating             |
| passport / passport-local | Session-based authentication       |
| passport-google-oauth20   | Google Sign-In                     |
| sqlite3                   | Database                           |
| connect-sqlite3           | SQLite-backed session store        |
| bcryptjs                  | Password hashing                   |
| @anthropic-ai/sdk         | Claude AI integration              |
| nodemailer                | Transactional email                |
| node-cron                 | Scheduled background jobs          |
| express-validator         | Request input validation           |
| connect-flash             | Flash messages across redirects    |

---

*Stratiq is for educational simulation only. Not financial advice.*