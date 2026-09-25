# NoleggioFiera

Piattaforma per gestire il parco **monitor e TV a noleggio**: cosa hai in
magazzino, dove è impegnato e soprattutto **cosa è libero e cosa no** in un
qualsiasi periodo.

Tre aree, come richiesto:

| Area | A cosa serve |
|---|---|
| **Prodotti** | Il catalogo di quello che noleggi: TV, monitor, videowall, totem, supporti, accessori. Ogni articolo ha un numero di pezzi in magazzino. |
| **Fiere** | Gli eventi dove il materiale viene noleggiato, raccolti per **manifestazione**: Pharmexpo è una manifestazione, Pharmexpo 2025 e 2026 sono due sue edizioni. |
| **Noleggi** | Il collegamento tra i due: quale prodotto va a quale cliente, su quale fiera, in che stand, in quali date e per che importo. |

A queste si aggiungono il **Cruscotto** (la situazione di oggi) e la
**Disponibilità**, la vista che separa in due elenchi *da noleggiare* e
*noleggiati* per il periodo che scegli, con un calendario di occupazione in
stile Gantt.

---

## Come ragiona la disponibilità

È il punto delicato, quindi vale la pena spiegarlo.

Ogni prodotto ha `N` pezzi. Un noleggio impegna `q` pezzi dal giorno `A` al
giorno `B` (estremi inclusi). Per sapere quanti pezzi restano liberi in un
periodo **non basta sommare i noleggi**: due noleggi consecutivi non si
sommano, mentre due sovrapposti sì.

La piattaforma scorre quindi giorno per giorno il periodo richiesto, somma i
pezzi impegnati in ciascun giorno e prende il **massimo** (il "picco"). I
pezzi disponibili sono `N - picco`: sono quelli che puoi promettere per
**tutto** il periodo senza rischi.

Conseguenze pratiche:

- Un noleggio che porterebbe il picco oltre `N` viene **rifiutato** con un
  messaggio che dice quanti pezzi restano e in che giorno si crea il conflitto.
- Non puoi abbassare i pezzi in magazzino sotto a quelli già impegnati.
- Solo gli stati **prenotato** e **consegnato** occupano magazzino.
  *Rientrato* e *annullato* liberano subito i pezzi, anche a metà periodo.
- Un prodotto **in manutenzione** risulta a zero disponibilità e non è
  noleggiabile finché non torna attivo.
- Le fiere hanno **giorni di allestimento e smontaggio**: il materiale risulta
  fuori dal magazzino già prima dell'apertura e ancora dopo la chiusura. Quando
  assegni materiale a una fiera le date vengono precompilate tenendone conto.

Una **manifestazione** si ripete negli anni; ogni anno è un'**edizione** con
date, sede e noleggi propri. Aprendo un'edizione trovi il confronto con le
altre — pezzi, clienti e fatturato — che è quello che serve quando prepari
l'edizione nuova. Il campo Manifestazione suggerisce quelle già presenti, così
un refuso non crea un doppione.

Cliente e stand stanno sul **noleggio**, non sulla fiera: a una stessa fiera
partecipano decine di aziende, ognuna con il proprio stand e le proprie date.
L'importo è quello **del lavoro**, non un prezzo al giorno: è così che vengono
quotati i noleggi.

---

## Importare lo storico da Airtable

I dati della base Airtable *Noleggio Breve Termine* sono già estratti in
`dati/` e si caricano con un comando:

```bash
npm run importa              # prova: mostra cosa farebbe, senza scrivere
npm run importa -- --scrivi  # esegue
```

Sulla VPS, con Docker:

```bash
cd /opt/noleggiofiera && docker compose exec app npm run importa -- --scrivi
```

L'importazione è **idempotente**: ogni riga porta il proprio ID Airtable, quindi
rilanciarla non crea duplicati.

### Come vengono tradotti i dati

| Airtable | Piattaforma |
|---|---|
| `Inventario` (un record per apparecchio) | un prodotto con 1 pezzo, codice `INV-<numero>` |
| `Stato`: Da noleggiare / Guasto / Regalata | attivo / in manutenzione / dismesso |
| `Clienti` (campo *Fiera*) | un'edizione; il nome viene diviso in manifestazione + anno |
| `Richieste` | un noleggio per ogni apparecchio collegato |
| `Azienda`, `Stand` | cliente e stand del noleggio |
| `Costo` | importo del noleggio (diviso, se la richiesta copre più apparecchi) |
| `Task`: Installato / Da Installare | rientrato o consegnato / prenotato |

Tre scelte fatte in fase di importazione, che è bene conoscere:

1. **Le date delle fiere sono dedotte** dal primo e dall'ultimo giorno dei
   noleggi collegati, perché in Airtable la fiera non ha date proprie. Per le
   fiere che non avevano date su nessuna richiesta (Siferr 2026, BMT 2026,
   Pharmexpo 2026) è stata messa una **stima**, segnalata nelle note della
   fiera: vanno corrette a mano.
2. **I noleggi già conclusi entrano come "rientrato"**, così lo storico non
   occupa il magazzino e non falsa il calcolo delle disponibilità future.
3. **Le edizioni della stessa manifestazione vengono unite**: "Pharmexpo 2025"
   e "Pharmexpo 2026" finiscono sotto Pharmexpo. "LTS Expo 2025" e "LTS 2026"
   sono riconciliate tramite la tabella `ALIAS_MANIFESTAZIONE`
   nell'importatore: aggiungine una riga se ne trovi altre scritte in modo
   diverso negli anni.
4. **Le richieste senza materiale collegato vengono ignorate** (in Airtable ce
   ne sono due, per 300 € complessivi) e così le fiere senza alcun noleggio.

---

## Avvio in locale

Serve Node.js 20 o superiore.

```bash
npm install
npm run seed     # dati di esempio: 12 prodotti, 5 fiere, i relativi noleggi
npm start
```

L'app risponde su <http://localhost:3000>. La password predefinita è
`noleggio2026`; cambiala con la variabile `APP_PASSWORD`.

| Variabile | Predefinito | A cosa serve |
|---|---|---|
| `PORT` | `3000` | Porta di ascolto. |
| `APP_PASSWORD` | `noleggio2026` | Password unica di accesso. |
| `SESSION_SECRET` | casuale a ogni avvio | Firma i cookie di sessione. Se non la imposti, a ogni riavvio tutti devono rifare il login. |
| `DATA_DIR` | `./data` | Cartella del file SQLite. |

---

## Deploy sulla VPS

Il deploy è pensato per **non toccare nulla di quello che gira già** sulla
macchina: usa una cartella dedicata, un volume Docker dedicato e una **porta
alta dedicata** (8099 di default). Non occupa la 80 né la 443 e non tocca
nginx, apache o altri servizi presenti.

```bash
# sulla VPS, come root
mkdir -p /opt/noleggiofiera && cd /opt/noleggiofiera
git clone -b claude/monitor-rental-platform-is8lhc \
  https://github.com/lumontech/noleggiofiera2.git .
./scripts/deploy.sh
```

Lo script controlla che Docker ci sia, genera un `.env` con password e chiave
di sessione casuali, verifica che la porta sia libera, costruisce l'immagine e
aspetta che l'app risponda. Alla fine stampa indirizzo e password.

Se la porta 8099 è già occupata:

```bash
PORTA_HOST=8123 ./scripts/deploy.sh
```

### Se il sito va in timeout

Quasi sempre è il **firewall**: il container gira ma la porta non è raggiungibile
da fuori. Lo script avvisa se se ne accorge, ma controllalo comunque.

```bash
# la porta è aperta sul firewall della macchina?
ufw allow 8099/tcp                                   # se usi ufw
firewall-cmd --permanent --add-port=8099/tcp && firewall-cmd --reload   # se usi firewalld

# l'app risponde in locale sulla VPS?
curl -s http://127.0.0.1:8099/api/salute             # atteso: {"ok":true,...}

# il container è in piedi?
docker compose ps
```

Se `curl` in locale risponde ma dall'esterno no, il blocco è nel firewall della
macchina **o nel pannello di controllo del provider** (molti hanno un firewall
separato, a monte della VPS): apri la porta anche lì.

### Indirizzo con dominio nip.io

[nip.io](https://nip.io) risolve qualsiasi nome nella forma
`qualcosa.<IP>.nip.io` verso quell'IP, senza configurare nulla da nessuna
parte. Con l'IP `81.17.100.112` e la porta predefinita, l'indirizzo è:

```
http://noleggiofierafinale.81.17.100.112.nip.io:8099
```

Funziona subito dopo il deploy: non serve registrare domini né modificare DNS.

### Senza Docker

Se preferisci non usare Docker, c'è l'alternativa con systemd (richiede
Node.js 20+ sulla macchina):

```bash
./scripts/installa-systemd.sh
```

Crea un utente di sistema dedicato, mette i dati in `/var/lib/noleggiofiera` e
registra il servizio `noleggiofiera`.

### Comandi utili

```bash
docker compose logs -f app              # log
docker compose exec app npm run seed    # carica i dati di esempio
docker compose restart app              # riavvio
docker compose down                     # ferma (i dati restano nel volume)
```

### Backup

Tutto sta in un unico file SQLite dentro il volume `noleggiofiera_dati`:

```bash
docker compose exec app sh -c 'cat /dati/noleggiofiera.sqlite' > backup-$(date +%F).sqlite
```

---

## Messa in sicurezza

L'accesso è protetto da una password condivisa, sufficiente per un piccolo
team interno. Prima di usarla con dati veri:

1. **Cambia `APP_PASSWORD`** nel file `.env` (lo script ne genera già una
   casuale, ma puoi metterne una tua) e riavvia con `docker compose up -d`.
2. **Imposta `SESSION_SECRET`** con una stringa lunga e casuale
   (`openssl rand -hex 32`). Se manca, viene rigenerata a ogni riavvio e le
   sessioni decadono.
3. Il traffico su nip.io viaggia in **HTTP**, quindi la password passa in
   chiaro. Se l'app deve restare esposta a lungo, mettila dietro un reverse
   proxy con certificato (Caddy prende un certificato Let's Encrypt in
   automatico anche per i nomi nip.io). Non è incluso nel deploy proprio per
   non interferire con quello che già occupa le porte 80 e 443 sulla VPS.

---

## Com'è fatto

Niente framework front-end e niente passaggio di build: il browser carica
moduli ES nativi, quindi quello che c'è nel repository è esattamente quello che
gira.

```
src/
  server.js               avvio, middleware, gestione errori
  seed.js                 dati di esempio
  lib/
    db.js                 schema SQLite e connessione
    domain.js             costanti, validazione, utility sulle date
    disponibilita.js      motore di calcolo del picco di impegno
    auth.js               password condivisa e cookie firmato HMAC
  routes/
    prodotti.js  fiere.js  noleggi.js  disponibilita.js
public/
  index.html
  css/app.css
  js/
    app.js                shell, login, routing via hash
    api.js                client HTTP
    ui.js                 helper DOM, formattazione, modali, avvisi
    views/                una vista per sezione
```

**Stack:** Node.js 22, Express 4, SQLite (better-sqlite3), JavaScript nel
browser senza dipendenze. Il database è un singolo file: per copiarlo o
ripristinarlo basta spostare quel file.

### API

Tutte le rotte sotto `/api` richiedono il cookie di sessione, tranne
`/api/salute`, `/api/accesso` e `/api/sessione`.

| Metodo | Rotta | Descrizione |
|---|---|---|
| `POST` | `/api/accesso` | Login con `{ password }`. |
| `GET` | `/api/prodotti` | Elenco con disponibilità di oggi e picco a 30 giorni. |
| `POST` `PUT` `DELETE` | `/api/prodotti[/:id]` | Gestione catalogo. |
| `GET` | `/api/fiere` | Elenco con pezzi impegnati e valore stimato. |
| `GET` | `/api/fiere/:id/finestra` | Date suggerite considerando allestimento e smontaggio. |
| `GET` `POST` `PUT` `DELETE` | `/api/noleggi[/:id]` | Righe di noleggio, con controllo di capienza. |
| `PATCH` | `/api/noleggi/:id/stato` | Avanzamento stato. |
| `GET` | `/api/disponibilita?from=&to=` | Prospetto *da noleggiare* / *noleggiati*. |
| `GET` | `/api/disponibilita/timeline?from=&to=` | Dati del calendario di occupazione. |
| `GET` | `/api/disponibilita/dashboard` | Numeri del cruscotto. |
