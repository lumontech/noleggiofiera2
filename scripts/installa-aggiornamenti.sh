#!/usr/bin/env bash
#
# Attiva l'aggiornamento automatico di NoleggioFiera: da qui in poi ogni
# modifica pubblicata su GitHub va online da sola entro un paio di minuti.
#
# Da lanciare una volta sola, da root, nella cartella del progetto già
# installato con scripts/deploy.sh:
#
#   cd /opt/noleggiofiera && git pull && ./scripts/installa-aggiornamenti.sh
#
# Aggiunge solo un timer systemd dedicato (noleggiofiera-aggiorna). Non
# modifica altri servizi della macchina. Per toglierlo:
#   systemctl disable --now noleggiofiera-aggiorna.timer
#
set -euo pipefail

CARTELLA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
NOME=noleggiofiera-aggiorna

verde() { printf '\033[32m%s\033[0m\n' "$*"; }
rosso() { printf '\033[31m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m%s\033[0m\n' "$*"; }

cd "$CARTELLA"

if [ "$(id -u)" -ne 0 ] && [ "$SYSTEMD_DIR" = /etc/systemd/system ]; then
  rosso "Serve eseguirlo da root."
  exit 1
fi
if [ ! -f .env ]; then
  rosso "Manca il file .env: prima installa l'app con ./scripts/deploy.sh"
  exit 1
fi
if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi

info "== Attivo l'aggiornamento automatico in $CARTELLA =="

cat > "$SYSTEMD_DIR/$NOME.service" <<FINE
[Unit]
Description=NoleggioFiera: scarica e installa le nuove versioni da GitHub
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$CARTELLA
ExecStart=$CARTELLA/scripts/aggiorna.sh
Nice=10
FINE

cat > "$SYSTEMD_DIR/$NOME.timer" <<FINE
[Unit]
Description=NoleggioFiera: controlla ogni 2 minuti se c'è una versione nuova

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
Persistent=true

[Install]
WantedBy=timers.target
FINE

$SYSTEMCTL daemon-reload
$SYSTEMCTL enable --now "$NOME.timer"
verde "Timer attivo: controllo ogni 2 minuti."

info "Porto subito online l'ultima versione (1-3 minuti)..."
if ! FORZA=1 ./scripts/aggiorna.sh; then
  rosso "L'aggiornamento non è riuscito. Dettagli qui sopra e in: journalctl -u $NOME"
  exit 1
fi

info "Importo lo storico di Airtable, se l'archivio è ancora vuoto..."
$COMPOSE exec -T app node src/importa-airtable.js --scrivi --solo-se-vuoto

set -a; . ./.env; set +a
VERSIONE="$(curl -fsS "http://127.0.0.1:${PORTA_HOST:-8099}/api/salute" | sed -E 's/.*"versione":"([^"]+)".*/\1/')"
echo
verde "Fatto. Da ora gli aggiornamenti arrivano da soli."
echo "  Versione online:   $VERSIONE  (la vedi anche in basso a sinistra nell'app)"
echo "  Cronologia:        journalctl -u $NOME --since today"
echo "  Stato del timer:   systemctl list-timers $NOME.timer"
