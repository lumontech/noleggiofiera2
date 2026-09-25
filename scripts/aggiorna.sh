#!/usr/bin/env bash
#
# Aggiornamento automatico di NoleggioFiera, lanciato ogni 2 minuti dal timer
# systemd "noleggiofiera-aggiorna" (vedi scripts/installa-aggiornamenti.sh).
#
# Controlla se su GitHub c'è una versione nuova; se sì la scarica, ricostruisce
# il container e verifica che risponda. Se la versione nuova non parte, torna
# da sola a quella precedente: il sito non resta mai giù per un aggiornamento.
#
# Tocca solo la cartella del progetto e il suo container.
#
set -euo pipefail

# Tutto sta dentro main(): bash legge una funzione per intero prima di eseguirla.
# Serve perché questo script aggiorna anche sé stesso (git reset): senza, bash
# continuerebbe a leggere il file mentre viene sostituito, mescolando le versioni.
main() {

  CARTELLA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  RAMO="${RAMO:-claude/monitor-rental-platform-is8lhc}"
  ATTESA_SALUTE="${ATTESA_SALUTE:-90}"
  cd "$CARTELLA"

  registra() { echo "[$(date '+%F %T')] $*"; }

  if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi

  set -a; . ./.env; set +a
  PORTA="${PORTA_HOST:-8099}"

  # Un solo aggiornamento alla volta: se uno è ancora in corso, si salta il giro.
  exec 9>"${TMPDIR:-/tmp}/noleggiofiera-aggiorna.lock"
  flock -n 9 || { registra "aggiornamento già in corso, salto"; exit 0; }

  # Con una versione: aspetta che risponda proprio quella (non il container vecchio).
  # Senza: basta che l'app risponda, qualunque versione sia.
  risponde() {
    local attesa='"ok":true'
    [ -n "${1:-}" ] && attesa="\"versione\":\"$1\""
    local limite=$(( $(date +%s) + ATTESA_SALUTE ))
    while [ "$(date +%s)" -lt "$limite" ]; do
      curl -fsS "http://127.0.0.1:$PORTA/api/salute" 2>/dev/null | grep -q "$attesa" && return 0
      sleep 3
    done
    return 1
  }

  avvia() {
    # La versione (commit) finisce nell'app, che la mostra in basso a sinistra:
    # così si sa sempre cosa sta girando. Il blocco (fd 9) non va passato a
    # quello che si avvia, o un processo lungo lo terrebbe e bloccherebbe per
    # sempre gli aggiornamenti successivi.
    VERSIONE="$1" $COMPOSE up -d --build 9>&-
  }

  git fetch --quiet origin "$RAMO"
  ATTUALE="$(git rev-parse HEAD)"
  NUOVA="$(git rev-parse "origin/$RAMO")"

  # Versione già provata e scartata perché non partiva: non la si riprova a ogni
  # giro, altrimenti il sito verrebbe riavviato ogni due minuti finché non
  # arriva una correzione. Si riprende appena su GitHub c'è una versione diversa.
  SCARTATA="$CARTELLA/.aggiorna-scartata"
  if [ "${FORZA:-0}" != "1" ] && [ -f "$SCARTATA" ] && [ "$(cat "$SCARTATA")" = "$NUOVA" ]; then exit 0; fi

  # Nessuna novità: il caso normale, silenzioso.
  if [ "$ATTUALE" = "$NUOVA" ] && [ "${FORZA:-0}" != "1" ]; then exit 0; fi

  BREVE_ATTUALE="$(git rev-parse --short "$ATTUALE")"
  BREVE_NUOVA="$(git rev-parse --short "$NUOVA")"
  if [ "$ATTUALE" = "$NUOVA" ]; then
    registra "reinstallo la versione $BREVE_NUOVA"
  else
    registra "nuova versione $BREVE_NUOVA (in uso $BREVE_ATTUALE): aggiorno"
  fi

  # .env e i dati non sono nel repository, quindi il reset non li tocca.
  git reset --quiet --hard "$NUOVA"

  if avvia "$BREVE_NUOVA" && risponde "$BREVE_NUOVA"; then
    rm -f "$SCARTATA"
    registra "versione $BREVE_NUOVA online"
    exit 0
  fi

  echo "$NUOVA" > "$SCARTATA"
  registra "ERRORE: la versione $BREVE_NUOVA non risponde, torno a $BREVE_ATTUALE (non la riproverò finché non ne arriva una nuova)"
  git reset --quiet --hard "$ATTUALE"
  # La versione precedente potrebbe non dichiarare il proprio numero: basta che risponda.
  if avvia "$BREVE_ATTUALE" && risponde; then
    registra "ripristinata la versione $BREVE_ATTUALE"
  else
    registra "ERRORE GRAVE: anche la versione $BREVE_ATTUALE non risponde. Log: $COMPOSE logs --tail 50 app"
  fi
  exit 1
}

main "$@"; exit $?
