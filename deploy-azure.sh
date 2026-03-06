#!/usr/bin/env bash
# ============================================================
# Stratiq — Azure App Service Deployment Script
# ============================================================
# Prerequisites:
#   - Azure CLI installed: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli
#   - Logged in: az login
#   - zip installed (brew install zip / apt install zip)
#
# Usage:
#   chmod +x deploy-azure.sh
#   ./deploy-azure.sh
#
# To override defaults, set env vars before running:
#   APP_NAME=my-stratiq REGION=canadacentral ./deploy-azure.sh
# ============================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}ℹ  $*${RESET}"; }
success() { echo -e "${GREEN}✓  $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠  $*${RESET}"; }
error()   { echo -e "${RED}✗  $*${RESET}"; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}── $* ──────────────────────────────${RESET}"; }

# ── Configuration (override via env vars) ─────────────────────
APP_NAME="${APP_NAME:-stratiq-$(openssl rand -hex 3)}"   # must be globally unique
RESOURCE_GROUP="${RESOURCE_GROUP:-stratiq-rg}"
REGION="${REGION:-canadacentral}"                         # az account list-locations -o table
APP_SERVICE_PLAN="${APP_SERVICE_PLAN:-stratiq-plan}"
SKU="${SKU:-B1}"                                          # F1=free(limited), B1=basic $13/mo, B2, S1, P1v3
NODE_VERSION="${NODE_VERSION:-18-lts}"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"

# ── SQLite persistence path (inside App Service container) ────
DB_PATH="${DB_PATH:-/home/data/stratiq.db}"

# ── Banner ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}"
cat << 'EOF'
   _____ _             _   _
  / ____| |           | | (_)
 | (___ | |_ _ __ __ _| |_ _  __ _
  \___ \| __| '__/ _` | __| |/ _` |
  ____) | |_| | | (_| | |_| | (_| |
 |_____/ \__|_|  \__,_|\__|_|\__, |
                               __/ |
                              |___/
EOF
echo -e "${RESET}"
echo -e "${BOLD}  Azure App Service Deployment${RESET}"
echo -e "  AI Investment Strategy Simulator"
echo ""

# ── Preflight checks ───────────────────────────────────────────
header "Preflight"

if ! command -v az &>/dev/null; then
  error "Azure CLI not found. Install from: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli"
fi
success "Azure CLI found: $(az version --query '"azure-cli"' -o tsv)"

if ! command -v zip &>/dev/null; then
  error "'zip' not found. Install with: brew install zip  OR  apt install zip"
fi
success "zip found"

if ! command -v node &>/dev/null; then
  warn "node not found locally — skipping local version check (not required for deployment)"
else
  success "Node.js: $(node --version)"
fi

# Require app.js to be present
if [ ! -f "app.js" ]; then
  error "app.js not found. Run this script from the Stratiq project root."
fi
success "app.js found — project root confirmed"

# ── Azure Login check ─────────────────────────────────────────
ACCOUNT=$(az account show --query "{name:name, id:id, user:user.name}" -o json 2>/dev/null || true)
if [ -z "$ACCOUNT" ]; then
  warn "Not logged in to Azure. Running 'az login'…"
  az login
  ACCOUNT=$(az account show --query "{name:name, id:id, user:user.name}" -o json)
fi

SUBSCRIPTION_NAME=$(echo "$ACCOUNT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['name'])" 2>/dev/null || echo "unknown")
SUBSCRIPTION_ID=$(echo "$ACCOUNT"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['id'])"   2>/dev/null || echo "unknown")
USER_NAME=$(echo "$ACCOUNT"         | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['user'])" 2>/dev/null || echo "unknown")

success "Logged in as  : ${USER_NAME}"
success "Subscription  : ${SUBSCRIPTION_NAME} (${SUBSCRIPTION_ID})"

# ── Confirm plan ───────────────────────────────────────────────
header "Deployment Plan"
echo -e "  App Name          : ${BOLD}${APP_NAME}${RESET}"
echo -e "  Resource Group    : ${BOLD}${RESOURCE_GROUP}${RESET}"
echo -e "  Region            : ${BOLD}${REGION}${RESET}"
echo -e "  App Service Plan  : ${BOLD}${APP_SERVICE_PLAN}${RESET} (SKU: ${SKU})"
echo -e "  Node Version      : ${BOLD}${NODE_VERSION}${RESET}"
echo -e "  DB Path (remote)  : ${BOLD}${DB_PATH}${RESET}"
echo -e "  Subscription      : ${BOLD}${SUBSCRIPTION_NAME}${RESET}"
echo ""
echo -e "  ${YELLOW}Note: SQLite is stored at ${DB_PATH} inside the container.${RESET}"
echo -e "  ${YELLOW}For production scale, migrate to Azure SQL or PostgreSQL.${RESET}"
echo ""
read -r -p "  Proceed? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { warn "Aborted."; exit 0; }

# ── Check .env for required keys ───────────────────────────────
header "Environment Validation"

MISSING_KEYS=()
REQUIRED_KEYS=("ANTHROPIC_API_KEY" "SMTP_HOST" "SMTP_USER" "SMTP_PASS")

if [ -f ".env" ]; then
  for KEY in "${REQUIRED_KEYS[@]}"; do
    VALUE=$(grep -E "^${KEY}=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'" | xargs 2>/dev/null || true)
    if [ -z "$VALUE" ] || [[ "$VALUE" == *"replace"* ]] || [[ "$VALUE" == *"your_"* ]]; then
      MISSING_KEYS+=("$KEY")
    fi
  done
else
  warn ".env file not found — app settings will need to be set manually in Azure Portal."
fi

if [ ${#MISSING_KEYS[@]} -gt 0 ]; then
  warn "The following keys look unconfigured in .env:"
  for K in "${MISSING_KEYS[@]}"; do echo -e "    ${YELLOW}  - ${K}${RESET}"; done
  echo ""
  echo -e "  ${YELLOW}AI features and email reports won't work without these.${RESET}"
  read -r -p "  Continue anyway? [y/N] " SKIP_CONFIRM
  [[ "$SKIP_CONFIRM" =~ ^[Yy]$ ]] || { warn "Aborted. Fill in .env and retry."; exit 0; }
else
  success "Required keys present in .env"
fi

# ── Build deployment package ───────────────────────────────────
header "Building Deployment Package"

DEPLOY_ZIP="stratiq-deploy.zip"

info "Zipping project (excluding node_modules, .git, .env, db files)…"
zip -r "$DEPLOY_ZIP" . \
  --exclude "*.git*" \
  --exclude "node_modules/*" \
  --exclude ".env" \
  --exclude "*.env.local" \
  --exclude "*.env.*.local" \
  --exclude "db/*.db" \
  --exclude "db/*.db-shm" \
  --exclude "db/*.db-wal" \
  --exclude "db/sessions.db" \
  --exclude "logs/*" \
  --exclude "$DEPLOY_ZIP" \
  --exclude "deploy-azure.sh" \
  --exclude ".DS_Store" \
  -q

success "Package created: ${DEPLOY_ZIP} ($(du -sh "$DEPLOY_ZIP" | cut -f1))"

# ── Resource Group ─────────────────────────────────────────────
header "Resource Group"

if az group show --name "$RESOURCE_GROUP" &>/dev/null; then
  warn "Resource group '${RESOURCE_GROUP}' already exists — reusing."
else
  info "Creating resource group '${RESOURCE_GROUP}' in ${REGION}…"
  az group create \
    --name "$RESOURCE_GROUP" \
    --location "$REGION" \
    --output none
  success "Resource group created."
fi

# ── App Service Plan ───────────────────────────────────────────
header "App Service Plan"

if az appservice plan show --name "$APP_SERVICE_PLAN" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  warn "App Service Plan '${APP_SERVICE_PLAN}' already exists — reusing."
else
  info "Creating App Service Plan '${APP_SERVICE_PLAN}' (SKU: ${SKU}, Linux)…"
  az appservice plan create \
    --name "$APP_SERVICE_PLAN" \
    --resource-group "$RESOURCE_GROUP" \
    --sku "$SKU" \
    --is-linux \
    --output none
  success "App Service Plan created."
fi

# ── Web App ────────────────────────────────────────────────────
header "Web App"

APP_EXISTS=false
if az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  warn "Web App '${APP_NAME}' already exists — updating deployment."
  APP_EXISTS=true
else
  info "Creating Web App '${APP_NAME}'…"
  az webapp create \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --plan "$APP_SERVICE_PLAN" \
    --runtime "NODE:${NODE_VERSION}" \
    --output none
  success "Web App '${APP_NAME}' created."
fi

# ── Persistent storage for SQLite ─────────────────────────────
header "Persistent Storage"

info "Enabling Always On (keeps cron jobs alive) and configuring storage path…"

# Always On keeps the app warm — required for cron jobs (B1+ only, not F1)
if [[ "$SKU" != "F1" ]]; then
  az webapp config set \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --always-on true \
    --output none
  success "Always On enabled (cron jobs will run reliably)."
else
  warn "SKU is F1 — Always On not available. Cron jobs may be unreliable. Consider upgrading to B1."
fi

# Set startup command
az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "node app.js" \
  --output none
success "Startup command set: node app.js"

# ── App Settings (environment variables) ──────────────────────
header "App Settings"

info "Setting core environment variables…"
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV="production" \
    PORT="8080" \
    APP_URL="https://${APP_NAME}.azurewebsites.net" \
    SESSION_SECRET="$SESSION_SECRET" \
    DB_PATH="$DB_PATH" \
    WEBSITE_NODE_DEFAULT_VERSION="~18" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true" \
    WEBSITE_RUN_FROM_PACKAGE="0" \
  --output none

success "Core app settings configured."

# ── Sync .env keys to App Settings ────────────────────────────
if [ -f ".env" ]; then
  info "Syncing non-empty API keys from .env to App Settings…"

  EXTRA_SETTINGS=()
  # Keys we already set above — don't duplicate
  SKIP_KEYS="NODE_ENV|PORT|APP_URL|SESSION_SECRET|DB_PATH|WEBSITE_NODE_DEFAULT_VERSION|SCM_DO_BUILD_DURING_DEPLOYMENT|WEBSITE_RUN_FROM_PACKAGE"

  while IFS='=' read -r KEY VALUE; do
    # Skip comments, blank lines, and already-handled keys
    [[ "$KEY" =~ ^#.*$   ]] && continue
    [[ -z "$KEY"         ]] && continue
    [[ -z "$VALUE"       ]] && continue
    [[ "$KEY" =~ ^($SKIP_KEYS)$ ]] && continue

    # Strip inline comments and surrounding quotes/whitespace
    VALUE=$(echo "$VALUE" | sed 's/[[:space:]]*#.*//' | tr -d '"' | tr -d "'" | xargs)
    [[ -z "$VALUE"       ]] && continue

    # Skip obvious placeholder values
    [[ "$VALUE" == *"your_"*     ]] && continue
    [[ "$VALUE" == *"replace_"*  ]] && continue
    [[ "$VALUE" == *"xxxxxxx"*   ]] && continue

    EXTRA_SETTINGS+=("${KEY}=${VALUE}")
  done < .env

  if [ ${#EXTRA_SETTINGS[@]} -gt 0 ]; then
    az webapp config appsettings set \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --settings "${EXTRA_SETTINGS[@]}" \
      --output none
    success "Synced ${#EXTRA_SETTINGS[@]} additional key(s) from .env:"
    for S in "${EXTRA_SETTINGS[@]}"; do
      KEY_ONLY=$(echo "$S" | cut -d'=' -f1)
      echo -e "      ${CYAN}+ ${KEY_ONLY}${RESET}"
    done
  else
    warn "No additional keys to sync from .env (all were empty or placeholders)."
  fi
fi

# ── Seed database on first deploy ──────────────────────────────
if [ "$APP_EXISTS" = false ]; then
  header "Database Seed"
  info "Scheduling post-deployment DB seed via App Settings trigger…"
  # We'll add a RUN_SEED flag — app.js can check this on startup
  # Alternatively, run seed via SSH after deploy (shown in summary)
  info "Use the SSH command in the summary below to run 'npm run seed' after first deploy."
fi

# ── Deploy code ────────────────────────────────────────────────
header "Deploying Code"

info "Uploading ${DEPLOY_ZIP} to Azure (this may take 1–3 minutes)…"
az webapp deploy \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src-path "$DEPLOY_ZIP" \
  --type zip \
  --output none

success "Code deployed successfully."

# ── Clean up local zip ─────────────────────────────────────────
rm -f "$DEPLOY_ZIP"
info "Cleaned up local deploy zip."

# ── Restart app to apply all settings ─────────────────────────
header "Restarting App"
info "Restarting '${APP_NAME}' to apply all settings…"
az webapp restart \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --output none
success "App restarted."

# ── Health check ───────────────────────────────────────────────
header "Health Check"

APP_URL="https://${APP_NAME}.azurewebsites.net"
info "Waiting for app to respond (up to 2 minutes)…"

HEALTHY=false
for i in $(seq 1 24); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$APP_URL" 2>/dev/null || echo "000")
  if [[ "$STATUS" == "200" || "$STATUS" == "302" || "$STATUS" == "301" ]]; then
    success "App is live! HTTP ${STATUS} ✓"
    HEALTHY=true
    break
  fi
  echo -e "  ${YELLOW}Attempt ${i}/24 — HTTP ${STATUS} — retrying in 5s…${RESET}"
  sleep 5
done

if [ "$HEALTHY" = false ]; then
  warn "App did not respond in time. It may still be starting up."
  warn "Check logs: az webapp log tail --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}"
fi

# ── Summary ────────────────────────────────────────────────────
header "Deployment Complete 🚀"
echo ""
echo -e "  ${BOLD}🌐 App URL:${RESET}           ${CYAN}${APP_URL}${RESET}"
echo -e "  ${BOLD}📊 Azure Portal:${RESET}      ${CYAN}https://portal.azure.com/#resource/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Web/sites/${APP_NAME}${RESET}"
echo ""
echo -e "  ${BOLD}🔑 Admin Login:${RESET}       admin@stratiq.io / Admin@Stratiq2025!"
echo -e "  ${BOLD}👤 Demo Login:${RESET}        demo@stratiq.io / Demo@1234!"
echo -e "  ${BOLD}🔐 Session Secret:${RESET}    ${SESSION_SECRET}"
echo ""

if [ "$APP_EXISTS" = false ]; then
  echo -e "  ${BOLD}${YELLOW}⚡ FIRST DEPLOY — Seed the database:${RESET}"
  echo -e "  ${YELLOW}  Run the following to initialise admin + demo accounts:${RESET}"
  echo ""
  echo -e "    ${BOLD}az webapp ssh --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}${RESET}"
  echo -e "    ${BOLD}# then inside the SSH session:${RESET}"
  echo -e "    ${BOLD}cd /home/site/wwwroot && npm run seed${RESET}"
  echo ""
fi

echo -e "${BOLD}Useful commands:${RESET}"
echo ""
echo "  # Stream live logs"
echo "  az webapp log tail --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}"
echo ""
echo "  # SSH into the container"
echo "  az webapp ssh --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}"
echo ""
echo "  # Redeploy after code changes"
echo "  ./deploy-azure.sh"
echo ""
echo "  # Update a single env var (e.g. API key)"
echo "  az webapp config appsettings set --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --settings ANTHROPIC_API_KEY=sk-ant-..."
echo ""
echo "  # Open in browser (macOS)"
echo "  open ${APP_URL}"
echo "  # Open in browser (Linux)"
echo "  xdg-open ${APP_URL}"
echo ""
echo "  # Tear down everything"
echo "  az group delete --name ${RESOURCE_GROUP} --yes --no-wait"
echo ""
warn "Save your SESSION_SECRET — you'll need it if you redeploy or scale out."
echo ""