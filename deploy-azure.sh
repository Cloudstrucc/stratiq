#!/usr/bin/env bash
# ============================================================
# Stratiq -- Azure App Service Deployment Script
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
# Overrides (set env vars before running):
#   APP_NAME=my-stratiq REGION=canadacentral ./deploy-azure.sh
#   NODE_VERSION=NODE:20-lts ./deploy-azure.sh
# ============================================================

set -euo pipefail

# -- Colours --------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}  i  $*${RESET}"; }
success() { echo -e "${GREEN}  v  $*${RESET}"; }
warn()    { echo -e "${YELLOW}  !  $*${RESET}"; }
error()   { echo -e "${RED}  x  $*${RESET}"; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}-- $* ${RESET}"; echo ""; }

# -- Configuration (override via env vars) --------------------
APP_NAME="${APP_NAME:-stratiq-$(openssl rand -hex 3)}"  # must be globally unique
RESOURCE_GROUP="${RESOURCE_GROUP:-stratiq-rg}"
REGION="${REGION:-canadacentral}"                        # az account list-locations -o table
APP_SERVICE_PLAN="${APP_SERVICE_PLAN:-stratiq-plan}"
SKU="${SKU:-B1}"                                         # F1=free(limited), B1=$13/mo, B2, S1, P1v3
NODE_VERSION="${NODE_VERSION:-}"                         # auto-detected; or set e.g. NODE:20-lts
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
DB_PATH="${DB_PATH:-/home/data/stratiq.db}"              # persistent /home volume in App Service

# -- Banner ---------------------------------------------------
echo ""
echo -e "${BOLD}${CYAN}"
cat << 'BANNER'
   _____ _             _   _
  / ____| |           | | (_)
 | (___ | |_ _ __ __ _| |_ _  __ _
  \___ \| __| '__/ _` | __| |/ _` |
  ____) | |_| | | (_| | |_| | (_| |
 |_____/ \__|_|  \__,_|\__|_|\__, |
                               __/ |
                              |___/
BANNER
echo -e "${RESET}"
echo -e "${BOLD}  Azure App Service Deployment${RESET}"
echo -e "  AI Investment Strategy Simulator"
echo ""

# -- Preflight checks -----------------------------------------
header "Preflight"

if ! command -v az &>/dev/null; then
  error "Azure CLI not found. Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli"
fi
success "Azure CLI: $(az version --query '"azure-cli"' -o tsv)"

if ! command -v zip &>/dev/null; then
  error "'zip' not found. Install: brew install zip  OR  apt install zip"
fi
success "zip: OK"

if ! command -v node &>/dev/null; then
  warn "node not found locally (not required for deployment)"
else
  success "Node.js: $(node --version)"
fi

if [ ! -f "app.js" ]; then
  error "app.js not found. Run this script from the Stratiq project root."
fi
success "app.js found -- project root confirmed"

# -- Azure Login ----------------------------------------------
ACCOUNT=$(az account show --query "{name:name, id:id, user:user.name}" -o json 2>/dev/null || true)
if [ -z "$ACCOUNT" ]; then
  warn "Not logged in to Azure. Running 'az login'..."
  az login
  ACCOUNT=$(az account show --query "{name:name, id:id, user:user.name}" -o json)
fi

SUBSCRIPTION_NAME=$(echo "$ACCOUNT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['name'])" 2>/dev/null || echo "unknown")
SUBSCRIPTION_ID=$(echo "$ACCOUNT"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['id'])"   2>/dev/null || echo "unknown")
USER_NAME=$(echo "$ACCOUNT"         | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['user'])" 2>/dev/null || echo "unknown")

success "Logged in as  : ${USER_NAME}"
success "Subscription  : ${SUBSCRIPTION_NAME} (${SUBSCRIPTION_ID})"

# -- Auto-detect valid Node.js runtime ------------------------
header "Detecting Node.js Runtime"

info "Querying available Linux runtimes from your Azure subscription..."

RUNTIME_LIST=$(az webapp list-runtimes --os-type linux --output tsv 2>/dev/null || true)

if [ -z "$RUNTIME_LIST" ]; then
  warn "Could not fetch runtime list -- falling back to NODE:20-lts"
  DETECTED_RUNTIME="NODE:20-lts"
else
  # Print what is available for reference
  NODE_RUNTIMES=$(echo "$RUNTIME_LIST" | grep -i "^NODE" || true)
  info "Available Node runtimes in your subscription:"
  echo "$NODE_RUNTIMES" | while read -r RT; do echo "      $RT"; done
  echo ""

  # Prefer Node 20 LTS, then 18 LTS, then newest available
  DETECTED_RUNTIME=$(echo "$NODE_RUNTIMES" | grep -iE "NODE:[[:space:]]*20" | sort -rV | head -1 || true)
  if [ -z "$DETECTED_RUNTIME" ]; then
    DETECTED_RUNTIME=$(echo "$NODE_RUNTIMES" | grep -iE "NODE:[[:space:]]*18" | sort -rV | head -1 || true)
  fi
  if [ -z "$DETECTED_RUNTIME" ]; then
    DETECTED_RUNTIME=$(echo "$NODE_RUNTIMES" | sort -rV | head -1 || true)
  fi
  if [ -z "$DETECTED_RUNTIME" ]; then
    DETECTED_RUNTIME="NODE:20-lts"
    warn "No NODE runtime matched -- using fallback: ${DETECTED_RUNTIME}"
  fi
fi

# Manual override wins
if [ -n "$NODE_VERSION" ]; then
  RUNTIME="$NODE_VERSION"
  info "Using manually specified runtime: ${RUNTIME}"
else
  RUNTIME="$DETECTED_RUNTIME"
  success "Selected runtime: ${RUNTIME}"
fi

# Extract numeric major version for WEBSITE_NODE_DEFAULT_VERSION (e.g. NODE:20-lts -> ~20)
NODE_MAJOR=$(echo "$RUNTIME" | grep -oE '[0-9]+' | head -1 || echo "20")

# -- Confirm plan ---------------------------------------------
header "Deployment Plan"
echo -e "  App Name          : ${BOLD}${APP_NAME}${RESET}"
echo -e "  Resource Group    : ${BOLD}${RESOURCE_GROUP}${RESET}"
echo -e "  Region            : ${BOLD}${REGION}${RESET}"
echo -e "  App Service Plan  : ${BOLD}${APP_SERVICE_PLAN}${RESET} (SKU: ${SKU})"
echo -e "  Runtime           : ${BOLD}${RUNTIME}${RESET}"
echo -e "  DB Path (remote)  : ${BOLD}${DB_PATH}${RESET}"
echo -e "  Subscription      : ${BOLD}${SUBSCRIPTION_NAME}${RESET}"
echo ""
echo -e "  ${YELLOW}Note: SQLite is stored at ${DB_PATH} (Azure /home persistent volume).${RESET}"
echo -e "  ${YELLOW}For production scale, migrate to Azure Database for PostgreSQL.${RESET}"
echo ""
read -r -p "  Proceed? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { warn "Aborted."; exit 0; }

# -- .env validation ------------------------------------------
header "Environment Validation"

MISSING_KEYS=()
REQUIRED_KEYS=("ANTHROPIC_API_KEY" "SMTP_HOST" "SMTP_USER" "SMTP_PASS")

if [ -f ".env" ]; then
  for KEY in "${REQUIRED_KEYS[@]}"; do
    VALUE=$(grep -E "^${KEY}=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'" | xargs 2>/dev/null || true)
    if [ -z "$VALUE" ] || [[ "$VALUE" == *"replace"* ]] || [[ "$VALUE" == *"your_"* ]] || [[ "$VALUE" == *"xxxxxxx"* ]]; then
      MISSING_KEYS+=("$KEY")
    fi
  done
else
  warn ".env not found -- app settings will need to be configured manually in Azure Portal."
fi

if [ ${#MISSING_KEYS[@]} -gt 0 ]; then
  warn "These keys look unconfigured in .env:"
  for K in "${MISSING_KEYS[@]}"; do echo -e "    ${YELLOW}  - ${K}${RESET}"; done
  echo ""
  warn "AI features and email reports will not work without these."
  read -r -p "  Continue anyway? [y/N] " SKIP_CONFIRM
  [[ "$SKIP_CONFIRM" =~ ^[Yy]$ ]] || { warn "Aborted. Fill in .env and retry."; exit 0; }
else
  success "Required keys present in .env"
fi

# -- Build deployment package ---------------------------------
header "Building Deployment Package"

DEPLOY_ZIP="stratiq-deploy.zip"

info "Zipping project (excluding node_modules, .git, .env, db files)..."
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

# -- Resource Group -------------------------------------------
header "Resource Group"

if az group show --name "$RESOURCE_GROUP" &>/dev/null; then
  warn "Resource group '${RESOURCE_GROUP}' already exists -- reusing."
else
  info "Creating resource group '${RESOURCE_GROUP}' in ${REGION}..."
  az group create \
    --name "$RESOURCE_GROUP" \
    --location "$REGION" \
    --output none
  success "Resource group created."
fi

# -- App Service Plan -----------------------------------------
header "App Service Plan"

if az appservice plan show --name "$APP_SERVICE_PLAN" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  warn "App Service Plan '${APP_SERVICE_PLAN}' already exists -- reusing."
else
  info "Creating App Service Plan '${APP_SERVICE_PLAN}' (SKU: ${SKU}, Linux)..."
  az appservice plan create \
    --name "$APP_SERVICE_PLAN" \
    --resource-group "$RESOURCE_GROUP" \
    --sku "$SKU" \
    --is-linux \
    --output none
  success "App Service Plan created."
fi

# -- Web App --------------------------------------------------
header "Web App"

APP_EXISTS=false
if az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  warn "Web App '${APP_NAME}' already exists -- updating."
  APP_EXISTS=true
else
  info "Creating Web App '${APP_NAME}' with runtime ${RUNTIME}..."
  az webapp create \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --plan "$APP_SERVICE_PLAN" \
    --runtime "$RUNTIME" \
    --output none
  success "Web App '${APP_NAME}' created."
fi

# -- Persistent storage & startup -----------------------------
header "Configuration"

# Always On: keeps cron jobs alive (B1+ only, not available on F1)
if [[ "$SKU" != "F1" ]]; then
  az webapp config set \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --always-on true \
    --startup-file "node app.js" \
    --output none
  success "Always On enabled + startup command set."
else
  az webapp config set \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --startup-file "node app.js" \
    --output none
  warn "SKU is F1 -- Always On not available. Cron jobs may sleep. Consider upgrading to B1."
fi

# -- App Settings ---------------------------------------------
header "App Settings"

info "Setting core environment variables..."
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV="production" \
    PORT="8080" \
    APP_URL="https://${APP_NAME}.azurewebsites.net" \
    SESSION_SECRET="$SESSION_SECRET" \
    DB_PATH="$DB_PATH" \
    WEBSITE_NODE_DEFAULT_VERSION="~${NODE_MAJOR}" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true" \
    WEBSITE_RUN_FROM_PACKAGE="0" \
  --output none

success "Core app settings configured."

# Sync extra keys from .env
if [ -f ".env" ]; then
  info "Syncing API keys from .env to App Settings..."

  EXTRA_SETTINGS=()
  SKIP_KEYS="NODE_ENV|PORT|APP_URL|SESSION_SECRET|DB_PATH|WEBSITE_NODE_DEFAULT_VERSION|SCM_DO_BUILD_DURING_DEPLOYMENT|WEBSITE_RUN_FROM_PACKAGE"

  while IFS='=' read -r KEY VALUE; do
    [[ "$KEY" =~ ^#.*$   ]] && continue
    [[ -z "$KEY"         ]] && continue
    [[ -z "$VALUE"       ]] && continue
    [[ "$KEY" =~ ^($SKIP_KEYS)$ ]] && continue

    VALUE=$(echo "$VALUE" | sed 's/[[:space:]]*#.*//' | tr -d '"' | tr -d "'" | xargs)
    [[ -z "$VALUE"       ]] && continue
    [[ "$VALUE" == *"your_"*    ]] && continue
    [[ "$VALUE" == *"replace_"* ]] && continue
    [[ "$VALUE" == *"xxxxxxx"*  ]] && continue

    EXTRA_SETTINGS+=("${KEY}=${VALUE}")
  done < .env

  if [ ${#EXTRA_SETTINGS[@]} -gt 0 ]; then
    az webapp config appsettings set \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --settings "${EXTRA_SETTINGS[@]}" \
      --output none
    success "Synced ${#EXTRA_SETTINGS[@]} key(s) from .env:"
    for S in "${EXTRA_SETTINGS[@]}"; do
      KEY_ONLY=$(echo "$S" | cut -d'=' -f1)
      echo -e "      ${CYAN}+ ${KEY_ONLY}${RESET}"
    done
  else
    warn "No additional keys to sync from .env (empty or placeholders only)."
  fi
fi

# -- Deploy code ----------------------------------------------
header "Deploying Code"

info "Uploading ${DEPLOY_ZIP} to Azure (1-3 minutes)..."
az webapp deploy \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src-path "$DEPLOY_ZIP" \
  --type zip \
  --output none

success "Code deployed."
rm -f "$DEPLOY_ZIP"
info "Cleaned up local deploy zip."

# -- Restart --------------------------------------------------
header "Restarting App"

info "Restarting '${APP_NAME}' to apply all settings..."
az webapp restart \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --output none
success "App restarted."

# -- Health check ---------------------------------------------
header "Health Check"

APP_URL="https://${APP_NAME}.azurewebsites.net"
info "Waiting for app to respond (up to 2 minutes)..."

HEALTHY=false
for i in $(seq 1 24); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$APP_URL" 2>/dev/null || echo "000")
  if [[ "$STATUS" == "200" || "$STATUS" == "302" || "$STATUS" == "301" ]]; then
    success "App is live! HTTP ${STATUS}"
    HEALTHY=true
    break
  fi
  echo -e "  ${YELLOW}Attempt ${i}/24 -- HTTP ${STATUS} -- retrying in 5s...${RESET}"
  sleep 5
done

if [ "$HEALTHY" = false ]; then
  warn "App did not respond within 2 minutes -- it may still be starting."
  warn "Check logs: az webapp log tail --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}"
fi

# -- Summary --------------------------------------------------
header "Deployment Complete"
echo ""
echo -e "  ${BOLD}URL:${RESET}              ${CYAN}${APP_URL}${RESET}"
echo -e "  ${BOLD}Azure Portal:${RESET}     ${CYAN}https://portal.azure.com/#resource/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Web/sites/${APP_NAME}${RESET}"
echo ""
echo -e "  ${BOLD}Admin login:${RESET}      admin@stratiq.io / Admin@Stratiq2025!"
echo -e "  ${BOLD}Demo login:${RESET}       demo@stratiq.io / Demo@1234!"
echo -e "  ${BOLD}Runtime used:${RESET}     ${RUNTIME}"
echo -e "  ${BOLD}Session secret:${RESET}   ${SESSION_SECRET}"
echo ""

if [ "$APP_EXISTS" = false ]; then
  echo -e "  ${BOLD}${YELLOW}FIRST DEPLOY -- seed the database now:${RESET}"
  echo ""
  echo "    az webapp ssh --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}"
  echo "    # inside SSH session:"
  echo "    cd /home/site/wwwroot && npm run seed"
  echo ""
fi

echo -e "${BOLD}Useful commands:${RESET}"
echo ""
echo "  # Stream live logs"
echo "  az webapp log tail --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}"
echo ""
echo "  # SSH into container"
echo "  az webapp ssh --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}"
echo ""
echo "  # List valid runtimes (if you need to change Node version)"
echo "  az webapp list-runtimes --os-type linux"
echo ""
echo "  # Update a single env var"
echo "  az webapp config appsettings set --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --settings ANTHROPIC_API_KEY=sk-ant-..."
echo ""
echo "  # Redeploy after code changes"
echo "  ./deploy-azure.sh"
echo ""
echo "  # Tear down everything"
echo "  az group delete --name ${RESOURCE_GROUP} --yes --no-wait"
echo ""
warn "Save your SESSION_SECRET above -- required if you redeploy or scale out."
echo ""