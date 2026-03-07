
# Stratiq — CLAUDE.md

## Project Overview

AI Investment Strategy Simulator — Node.js/Express app where Claude AI executes
simulated trades, generates daily portfolio reports, and guides portfolios using
named investment strategies (Buffett, Dalio, Lynch, Wood, Livermore, etc.).

Owner: CloudStrucc Inc. / Fred Pearson
Target: Production on Azure App Service (Canada Central)
Repo: https://github.com/Cloudstrucc/stratiq

---

## Tech Stack

* **Runtime:** Node.js (Express 4.x)
* **Templating:** express-handlebars (.hbs views)
* **Auth:** Passport.js — local strategy + Google OAuth2
* **Database:** SQLite (dev) → Azure Database for PostgreSQL Flexible Server (prod target)
* **AI:** @anthropic-ai/sdk — claude-sonnet-4-6 model
* **Jobs:** node-cron (3 scheduled jobs: daily reports, price updates, AI trades)
* **Email:** Nodemailer (SMTP)
* **Market Data:** Alpha Vantage API (mock fallback if key absent)
* **Deploy:** Azure App Service (Linux), deploy-azure.sh

---

## Directory Structure

```
stratiq/
├── app.js              # Express entry point + cron scheduler init
├── package.json
├── .env.example        # All environment variables documented
├── deploy-azure.sh     # One-command Azure App Service deploy
├── db/
│   ├── schema.sql      # 7-table SQLite schema
│   ├── database.js     # DB connection + promisified helpers
│   └── seed.js         # Admin + demo account seeder
├── config/
│   └── passport.js     # Auth strategies (local + Google OAuth)
├── middleware/
│   └── auth.js         # requireAuth, requireAdmin, requirePlan, guestOnly
├── routes/
│   ├── auth.js         # /auth/login, register, logout, google
│   ├── dashboard.js    # /dashboard/* views
│   ├── portfolio.js    # /portfolio/* CRUD + trade execution
│   ├── ai.js           # /ai/chat, simulate, history
│   └── admin.js        # /admin user management
├── services/
│   ├── aiService.js    # ALL Anthropic Claude calls (strategy sim, trades, summaries)
│   ├── emailService.js # Transactional email (daily reports, welcome, reset)
│   └── marketData.js   # Alpha Vantage price fetching + mock fallback
├── jobs/
│   └── dailyReport.js  # 3 cron jobs (daily reports, price updates, AI trades)
├── views/
│   ├── layouts/
│   │   ├── main.hbs        # Public layout
│   │   └── dashboard.hbs   # Authenticated layout (sidebar, topbar)
│   ├── auth/               # login.hbs, register.hbs
│   ├── dashboard/          # overview, portfolio, ai-strategy, trades, reports, settings
│   ├── admin/              # admin dashboard
│   ├── index.hbs           # Landing page
│   └── pricing.hbs         # Pricing page
└── public/
    ├── css/stratiq.css     # Full dark/light CSS system (CSS variables)
    └── js/
        ├── theme.js        # Theme toggle + localStorage persistence
        └── dashboard.js    # Chart theme sync on toggle
```

---

## Scheduled Jobs (node-cron)

All jobs auto-start on app boot. Always On (Azure B1+) is required.

| Job           | Schedule                    | Action                                          |
| ------------- | --------------------------- | ----------------------------------------------- |
| Daily Reports | 08:00 AM daily (ET)         | Generate AI portfolio summary + send emails     |
| Price Updates | Hourly, weekdays 9 AM–4 PM | Refresh all portfolio position prices           |
| AI Trades     | 09:30 AM weekdays           | Execute AI strategy decisions (Pro+ users only) |

---

## Investment Strategies

| Strategy        | Style                  | Risk   |
| --------------- | ---------------------- | ------ |
| Warren Buffett  | Value investing        | Low    |
| Ray Dalio       | All Weather            | Low    |
| DCA Index       | S&P 500 passive DCA    | Low    |
| Peter Lynch     | GARP                   | Medium |
| Cathie Wood     | Disruptive tech        | High   |
| Jesse Livermore | Momentum / trend       | High   |
| Manual          | Build your own         | Varies |
| Custom Prompt   | Freeform text strategy | Varies |

---

## Current State vs Production Target

### Known gaps to address (in priority order):

1. **Security headers** — No helmet.js configured
2. **Rate limiting** — No API rate limiting on any routes (needs express-rate-limit)
3. **Error handling** — Inconsistent; needs centralized error middleware in app.js
4. **Logging** — console.log only; needs structured logging (Winston or Pino) with Azure Log Analytics transport
5. **Health endpoint** — Missing /health route required for Azure App Service health checks
6. **Input validation** — express-validator is installed but inconsistently applied across routes
7. **Session store** — connect-sqlite3 not suitable for prod; needs Azure Redis Cache or PostgreSQL-backed store
8. **Database** — SQLite is dev-only; prod target = Azure Database for PostgreSQL Flexible Server
9. **CI/CD pipeline** — No GitHub Actions workflow yet; needs PR-gated deploy to Azure App Service Canada Central
10. **Test suite** — No tests; needs Jest unit tests for services (aiService, emailService, marketData) at minimum
11. **Secrets management** — .env file used locally; prod must use Azure Key Vault + App Settings (never commit secrets)

---

## Architecture Constraints

* Multi-tenant: users have plans (free / pro / premium) enforced via `requirePlan` middleware — do not bypass
* Admin panel at `/admin` — keep all admin routes strictly gated behind `requireAdmin`
* **All Anthropic SDK calls live in `services/aiService.js` only** — do not scatter Claude API calls elsewhere
* Cron jobs require Always On enabled (Azure B1+ SKU minimum) — never downgrade to F1 for any real usage
* SQLite DB path on Azure is `/home/data/stratiq.db` — this path uses the persistent `/home` volume that survives restarts and redeployments
* On redeploy, `*.db` files are excluded from the zip — production data is never overwritten

---

## Coding Standards

* **CommonJS modules only** — `require` / `module.exports` throughout; do not introduce ES module syntax
* Async/await preferred over callbacks or raw Promise chains
* Flash messages via `connect-flash` for all user-facing errors and success notices
* Handlebars helpers registered in `app.js` — add all new helpers there, not inline
* CSS: single file `public/css/stratiq.css` using CSS custom properties for dark/light theming — do not add separate theme files
* No TypeScript — plain JavaScript throughout the project
* Express validator: use `validationResult` pattern consistently — check existing route handlers before adding new validation

---

## Environment Variables

See `.env.example` for full annotated list.

Critical variables:

| Variable                | Notes                                                 |
| ----------------------- | ----------------------------------------------------- |
| ANTHROPIC_API_KEY       | Required for all AI features (sk-ant-api03-...)       |
| SESSION_SECRET          | Must be a long random string in production            |
| DB_PATH                 | ./db/stratiq.db (dev) / /home/data/stratiq.db (Azure) |
| NODE_ENV                | development or production                             |
| APP_URL                 | Full URL including https:// in production             |
| SMTP_HOST/USER/PASS     | Required for daily email reports                      |
| ALPHA_VANTAGE_KEY       | Optional — mock data used if absent                  |
| GOOGLE_CLIENT_ID/SECRET | Optional — enables Google OAuth login                |
| ADMIN_EMAIL/PASSWORD    | Used only during `npm run seed`                     |

---

## Deployment

* Azure App Service Linux, Canada Central region (preferred), or Canada East
* `deploy-azure.sh` handles: resource group → App Service plan → Web App creation → env sync → health check
* SKU: **B1 minimum** (Always On required for cron jobs), **B2 recommended** for production traffic
* DB files excluded from deploy zip — prod data is never overwritten on redeploy
* First deploy only: SSH into container and run `npm run seed` to initialize DB and create accounts
* Auto-detect Node runtime: script calls `az webapp list-runtimes --os-type linux` to avoid hardcoded version errors

### Useful Azure commands:

```bash
# Stream live logs
az webapp log tail --name <app-name> --resource-group stratiq-rg

# SSH into running container
az webapp ssh --name <app-name> --resource-group stratiq-rg

# Rotate API key without redeploying
az webapp config appsettings set \
  --name <app-name> --resource-group stratiq-rg \
  --settings ANTHROPIC_API_KEY=sk-ant-...

# Tear down all resources
az group delete --name stratiq-rg --yes --no-wait
```

---

## Suggested Plan Mode Sessions (in order)

Use `claude --permission-mode plan` for each of these. Describe the goal, let Claude
read the codebase and ask clarifying questions, review and refine the plan, then exit
plan mode to execute.

1. **Security hardening** — Add `helmet.js`, `express-rate-limit`, and centralize error middleware
2. **Observability** — Add Winston structured logging with Azure Log Analytics transport + /health endpoint
3. **Input validation audit** — Tighten `express-validator` usage consistently across all routes
4. **PostgreSQL migration** — Migrate DB layer to PostgreSQL (keep SQLite dev fallback via DATABASE_URL detection)
5. **CI/CD pipeline** — GitHub Actions workflow: lint → test → deploy to Azure App Service Canada Central on merge to main
6. **Test suite** — Jest unit tests for `aiService.js`, `emailService.js`, and `marketData.js`
7. **Session store** — Replace connect-sqlite3 with Redis-backed session store (Azure Cache for Redis)

---

## What NOT to Do

* Do NOT commit `.env`, `*.db`, or `node_modules`
* Do NOT use `sudo npm install -g` for any package
* Do NOT add Anthropic SDK calls outside of `services/aiService.js`
* Do NOT introduce breaking schema changes without a migration script
* Do NOT disable `requireAuth`, `requireAdmin`, or `requirePlan` middleware on protected routes
* Do NOT downgrade the Azure SKU to F1 — cron jobs will not fire reliably
* Do NOT hardcode Azure region or Node runtime version strings in deploy scripts

---

*Stratiq is for educational simulation only. Not financial advice.*
