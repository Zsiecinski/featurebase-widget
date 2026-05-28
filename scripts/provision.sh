#!/usr/bin/env bash
# One-time VPS bootstrap for the Featurebase Intercom Canvas app.
#
# Usage:
#   scp scripts/provision.sh user@your-vps:/tmp/
#   ssh user@your-vps "sudo DOMAIN=intercom-canvas.example.com bash /tmp/provision.sh"
#
# Env vars (or pass interactively):
#   DOMAIN        Hostname Caddy will obtain a TLS cert for. Required.
#   DEPLOY_USER   SSH user that will run scripts/deploy.ps1 from your laptop.
#                 Defaults to the user who invoked sudo.
#
# Idempotent: safe to re-run if a step fails partway through.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash provision.sh" >&2
  exit 1
fi

DOMAIN="${DOMAIN:-}"
# Deploy user defaults to whoever invoked the script. If you SSH'd as root and
# ran `bash provision.sh` directly, this becomes "root" — that's fine.
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-$(id -un)}}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

if [[ -z "$DOMAIN" ]]; then
  read -rp "Domain (e.g. intercom-canvas.example.com): " DOMAIN
fi

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "User '$DEPLOY_USER' does not exist on this server." >&2
  exit 1
fi

# Detect which web server (if any) is already in front of port 80/443.
# - If nginx is active -> integrate via nginx + certbot.
# - Otherwise -> install Caddy (auto-TLS).
WEB_SERVER="caddy"
if systemctl is-active --quiet nginx 2>/dev/null; then
  WEB_SERVER="nginx"
fi

# nginx path needs an email for Let's Encrypt registration.
if [[ "$WEB_SERVER" == "nginx" ]] && [[ -z "$LETSENCRYPT_EMAIL" ]]; then
  read -rp "Let's Encrypt contact email (for renewal warnings): " LETSENCRYPT_EMAIL
fi

APP_USER="fbapp"
APP_DIR="/opt/featurebase-intercom"
SERVICE="featurebase-intercom"

echo "==> Domain:       $DOMAIN"
echo "==> Deploy user:  $DEPLOY_USER"
echo "==> App user:     $APP_USER"
echo "==> App dir:      $APP_DIR"
echo "==> Web server:   $WEB_SERVER $([ "$WEB_SERVER" == "nginx" ] && echo "(detected existing)")"
echo

# ---------------------------------------------------------------------------
echo "==> Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync ufw debian-keyring debian-archive-keyring apt-transport-https

# ---------------------------------------------------------------------------
if ! command -v node >/dev/null || [[ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]]; then
  echo "==> Installing Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
else
  echo "==> Node $(node -v) already installed"
fi

# ---------------------------------------------------------------------------
if [[ "$WEB_SERVER" == "caddy" ]]; then
  if ! command -v caddy >/dev/null; then
    echo "==> Installing Caddy..."
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
  else
    echo "==> Caddy already installed"
  fi
else
  echo "==> Installing certbot (nginx plugin)..."
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# ---------------------------------------------------------------------------
if [[ "$WEB_SERVER" == "caddy" ]]; then
  echo "==> Configuring firewall (fresh box)..."
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
else
  echo "==> Skipping firewall changes — existing nginx setup, leaving ufw as-is."
fi

# ---------------------------------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "==> Creating app user '$APP_USER'..."
  adduser --system --group --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
else
  echo "==> App user '$APP_USER' already exists"
fi

mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"

# ---------------------------------------------------------------------------
echo "==> Writing placeholder .env (if missing)..."
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat > "$APP_DIR/.env" <<EOF
PORT=3000
FEATUREBASE_API_KEY=
FEATUREBASE_VERSION=2026-01-01.nova
ROADMAP_URL=https://staytuned.featurebase.app/roadmap/kiwi-sizing
MAX_ITEMS=8
NODE_ENV=production
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "    Wrote $APP_DIR/.env (MOCK mode — edit later to add your real API key)"
else
  echo "    $APP_DIR/.env already exists, leaving it alone"
fi

# ---------------------------------------------------------------------------
echo "==> Writing systemd unit..."
cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Featurebase Intercom Canvas app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
# Don't start yet — no code deployed.

# ---------------------------------------------------------------------------
if [[ "$WEB_SERVER" == "caddy" ]]; then
  echo "==> Writing Caddyfile..."
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
  systemctl reload caddy || systemctl restart caddy
else
  echo "==> Writing nginx server block for $DOMAIN..."
  NGINX_CONF="/etc/nginx/sites-available/featurebase-intercom"
  # Minimal HTTP-only block first, so certbot can pass the ACME challenge.
  cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/featurebase-intercom
  echo "==> Testing + reloading nginx..."
  nginx -t
  systemctl reload nginx

  # If the cert doesn't exist yet, request one. certbot --nginx mutates the
  # server block in place to add SSL + an HTTP->HTTPS redirect.
  if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
    echo "==> Requesting Let's Encrypt certificate for $DOMAIN..."
    certbot --nginx \
      -d "$DOMAIN" \
      --non-interactive \
      --agree-tos \
      --redirect \
      -m "$LETSENCRYPT_EMAIL"
  else
    echo "==> Certificate for $DOMAIN already exists, leaving it alone."
  fi
fi

# ---------------------------------------------------------------------------
echo "==> Installing deploy hook /usr/local/bin/fb-deploy-finish..."
cat > /usr/local/bin/fb-deploy-finish <<'HOOK'
#!/usr/bin/env bash
# Receives a tarball of the project, syncs it into the live dir, reinstalls
# deps, and restarts the service. Invoked by scripts/deploy.ps1.
set -euo pipefail

TAR_FILE="${1:-}"
APP_USER="fbapp"
APP_DIR="/opt/featurebase-intercom"
SERVICE="featurebase-intercom"

if [[ -z "$TAR_FILE" ]] || [[ ! -f "$TAR_FILE" ]]; then
  echo "usage: fb-deploy-finish <path-to-tar>" >&2
  exit 1
fi

STAGING="$(mktemp -d /tmp/fb-staging.XXXXXX)"
trap 'rm -rf "$STAGING" "$TAR_FILE"' EXIT

echo "  extracting tarball..."
tar -xf "$TAR_FILE" -C "$STAGING"

echo "  syncing into $APP_DIR (preserving .env)..."
rsync -a --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='.git' \
  "$STAGING/" "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "  installing production deps..."
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund"

echo "  restarting $SERVICE..."
systemctl restart "$SERVICE"
sleep 2

echo "  health check:"
if curl -fsS http://127.0.0.1:3000/health; then
  echo
  echo "  ok"
else
  echo
  echo "  FAILED — check: journalctl -u $SERVICE -n 50" >&2
  exit 1
fi
HOOK
chmod 755 /usr/local/bin/fb-deploy-finish

# ---------------------------------------------------------------------------
if [[ "$DEPLOY_USER" == "root" ]]; then
  echo "==> Deploy user is root — skipping sudoers entry (root already has full access)."
  rm -f /etc/sudoers.d/fb-deploy
else
  echo "==> Granting $DEPLOY_USER passwordless sudo for the deploy hook only..."
  cat > /etc/sudoers.d/fb-deploy <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/bin/fb-deploy-finish
EOF
  chmod 440 /etc/sudoers.d/fb-deploy
  visudo -cf /etc/sudoers.d/fb-deploy >/dev/null
fi

# ---------------------------------------------------------------------------
echo
echo "============================================================"
echo "Provisioning complete."
echo
echo "Next steps from your Windows machine:"
echo "  1. Make sure your DNS A record points $DOMAIN at this server."
echo "  2. From the project folder, run:"
echo "       scripts\\deploy.ps1 -VpsHost <ip-or-host> -User $DEPLOY_USER"
echo "  3. When the Featurebase API key arrives, on this server run:"
echo "       sudo nano $APP_DIR/.env       # set FEATUREBASE_API_KEY=..."
echo "       sudo systemctl restart $SERVICE"
echo
echo "Service:   systemctl status $SERVICE"
echo "Logs:      journalctl -u $SERVICE -f"
echo "Caddy:     journalctl -u caddy -f"
echo "============================================================"
