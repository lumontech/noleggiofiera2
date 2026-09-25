#!/usr/bin/env bash
#
# Alternativa a Docker: installa NoleggioFiera come servizio systemd.
# Usala se sulla VPS non c'è Docker o se preferisci non usarlo.
# Richiede Node.js 20 o superiore già presente sulla macchina.
#
# Uso (da root, dentro la cartella del progetto):
#   ./scripts/installa-systemd.sh
#
set -euo pipefail

CARTELLA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVIZIO=noleggiofiera
PORTA="${PORTA_HOST:-8099}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Serve eseguirlo da root (o con sudo)."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js non è installato. Installalo con:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
  exit 1
fi

VERSIONE="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$VERSIONE" -lt 20 ]; then
  echo "Serve Node.js 20 o superiore (trovato $VERSIONE)."
  exit 1
fi

cd "$CARTELLA"
npm install --omit=dev --no-audit --no-fund

if [ ! -f .env ]; then
  PASSWORD_GENERATA="$(head -c 9 /dev/urandom | base64 | tr -d '/+=' | cut -c1-12)"
  SEGRETO_GENERATO="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > .env <<FINE
APP_PASSWORD=$PASSWORD_GENERATA
SESSION_SECRET=$SEGRETO_GENERATO
PORTA_HOST=$PORTA
TZ=Europe/Rome
FINE
  chmod 600 .env
  echo "File .env creato. Password di accesso: $PASSWORD_GENERATA"
fi

set -a; . ./.env; set +a
PORTA="${PORTA_HOST:-$PORTA}"

id -u noleggio >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin noleggio
mkdir -p /var/lib/$SERVIZIO
chown -R noleggio:noleggio /var/lib/$SERVIZIO "$CARTELLA"

cat > /etc/systemd/system/$SERVIZIO.service <<FINE
[Unit]
Description=NoleggioFiera — gestione noleggio monitor e TV
After=network.target

[Service]
Type=simple
User=noleggio
WorkingDirectory=$CARTELLA
EnvironmentFile=$CARTELLA/.env
Environment=NODE_ENV=production
Environment=PORT=$PORTA
Environment=DATA_DIR=/var/lib/$SERVIZIO
ExecStart=$(command -v node) $CARTELLA/src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/$SERVIZIO

[Install]
WantedBy=multi-user.target
FINE

systemctl daemon-reload
systemctl enable --now $SERVIZIO
sleep 2
systemctl --no-pager --lines=10 status $SERVIZIO || true

IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "NoleggioFiera è attivo su:  http://noleggiofierafinale.$IP.nip.io:$PORTA"
echo "Utente:                     stefano"
echo "Password:                   $(grep '^APP_PASSWORD=' .env | cut -d= -f2-)"
echo "Log:                        journalctl -u $SERVIZIO -f"
