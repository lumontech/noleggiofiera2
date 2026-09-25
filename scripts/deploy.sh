#!/usr/bin/env bash
#
# Deploy di NoleggioFiera su una VPS, in una directory dedicata e su una porta
# dedicata. Non modifica nulla di quanto è già installato o in esecuzione:
# non tocca nginx/apache, non occupa la porta 80 o la 443, non installa
# pacchetti a parte Docker se manca (e in quel caso lo dice prima).
#
# Uso, da dentro la cartella del progetto già clonata sulla VPS:
#   ./scripts/deploy.sh
#
set -euo pipefail

CARTELLA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CARTELLA"

rosso() { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m%s\033[0m\n' "$*"; }

info "== NoleggioFiera — deploy in $CARTELLA =="

# --- 1. Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  rosso "Docker non è installato su questa macchina."
  echo "Installalo con:  curl -fsSL https://get.docker.com | sh"
  echo "Poi rilancia questo script."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  rosso "Manca il plugin 'docker compose'."
  echo "Installalo con:  apt-get install -y docker-compose-plugin"
  exit 1
fi

# --- 2. Configurazione -------------------------------------------------------
if [ ! -f .env ]; then
  info "Creo il file .env con valori generati..."
  PASSWORD_GENERATA="$(head -c 9 /dev/urandom | base64 | tr -d '/+=' | cut -c1-12)"
  SEGRETO_GENERATO="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > .env <<FINE
APP_PASSWORD=$PASSWORD_GENERATA
SESSION_SECRET=$SEGRETO_GENERATO
PORTA_HOST=${PORTA_HOST:-8099}
TZ=Europe/Rome
FINE
  chmod 600 .env
  verde "File .env creato. Password di accesso: $PASSWORD_GENERATA"
  echo "   (la ritrovi sempre con:  grep APP_PASSWORD $CARTELLA/.env )"
fi

set -a; . ./.env; set +a
PORTA="${PORTA_HOST:-8099}"

# --- 3. La porta scelta è libera? -------------------------------------------
if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$PORTA" 2>/dev/null | grep -q LISTEN; then
  if ! docker ps --format '{{.Names}} {{.Ports}}' | grep -q "noleggiofiera.*:$PORTA->"; then
    rosso "La porta $PORTA è già usata da un altro servizio."
    echo "Scegli una porta libera:  PORTA_HOST=8123 ./scripts/deploy.sh"
    echo "(ricordati di aggiornare anche PORTA_HOST dentro .env)"
    exit 1
  fi
fi

# --- 4. Avvio ----------------------------------------------------------------
info "Costruisco l'immagine e avvio il container..."
$COMPOSE up -d --build

info "Attendo che l'app risponda..."
for tentativo in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORTA/api/salute" >/dev/null 2>&1; then
    IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
    echo
    verde "Fatto. NoleggioFiera è online."
    echo "  Indirizzo:  http://noleggiofierafinale.$IP.nip.io:$PORTA"
    echo "  Oppure:     http://$IP:$PORTA"
    echo "  Password:   $(grep '^APP_PASSWORD=' .env | cut -d= -f2-)"
    echo
    echo "Dati salvati nel volume Docker 'noleggiofiera_dati' (sopravvivono ai riavvii)."
    echo "Per caricare dati di esempio:  $COMPOSE exec app npm run seed"
    echo "Per i log:                     $COMPOSE logs -f app"
    exit 0
  fi
  sleep 2
done

rosso "L'app non ha risposto entro 60 secondi. Log degli ultimi errori:"
$COMPOSE logs --tail 40 app
exit 1
