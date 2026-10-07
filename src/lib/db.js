import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'noleggiofiera.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS prodotti (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT    NOT NULL,
  categoria     TEXT    NOT NULL DEFAULT 'TV',
  marca         TEXT    DEFAULT '',
  modello       TEXT    DEFAULT '',
  codice        TEXT    DEFAULT '',
  pollici       REAL,
  risoluzione   TEXT    DEFAULT '',
  quantita      INTEGER NOT NULL DEFAULT 1,
  prezzo_giorno REAL    NOT NULL DEFAULT 0,
  stato         TEXT    NOT NULL DEFAULT 'attivo',
  note          TEXT    DEFAULT '',
  creato_il     TEXT    NOT NULL,
  aggiornato_il TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS fiere (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                TEXT    NOT NULL,
  manifestazione      TEXT    NOT NULL DEFAULT '',
  anno                INTEGER,
  cliente             TEXT    DEFAULT '',
  luogo               TEXT    DEFAULT '',
  citta               TEXT    DEFAULT '',
  padiglione          TEXT    DEFAULT '',
  stand               TEXT    DEFAULT '',
  data_inizio         TEXT    NOT NULL,
  data_fine           TEXT    NOT NULL,
  giorni_allestimento INTEGER NOT NULL DEFAULT 1,
  giorni_smontaggio   INTEGER NOT NULL DEFAULT 1,
  stato               TEXT    NOT NULL DEFAULT 'pianificata',
  note                TEXT    DEFAULT '',
  creato_il           TEXT    NOT NULL,
  aggiornato_il       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS noleggi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  prodotto_id   INTEGER NOT NULL REFERENCES prodotti(id) ON DELETE CASCADE,
  fiera_id      INTEGER NOT NULL REFERENCES fiere(id)    ON DELETE CASCADE,
  cliente       TEXT    DEFAULT '',
  stand         TEXT    DEFAULT '',
  quantita      INTEGER NOT NULL DEFAULT 1,
  data_inizio   TEXT    NOT NULL,
  data_fine     TEXT    NOT NULL,
  stato         TEXT    NOT NULL DEFAULT 'prenotato',
  importo       REAL    NOT NULL DEFAULT 0,
  note          TEXT    DEFAULT '',
  creato_il     TEXT    NOT NULL,
  aggiornato_il TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS utenti (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nome              TEXT    NOT NULL,
  accesso           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash     TEXT    NOT NULL,
  ruolo             TEXT    NOT NULL DEFAULT 'tecnico',
  attivo            INTEGER NOT NULL DEFAULT 1,
  versione_sessione INTEGER NOT NULL DEFAULT 1,
  ultimo_accesso    TEXT,
  creato_il         TEXT    NOT NULL,
  aggiornato_il     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS allegati (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fiera_id       INTEGER NOT NULL REFERENCES fiere(id) ON DELETE CASCADE,
  nome_originale TEXT    NOT NULL,
  nome_file      TEXT    NOT NULL,
  tipo           TEXT    NOT NULL,
  dimensione     INTEGER NOT NULL,
  creato_il      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_allegati_fiera ON allegati(fiera_id);

CREATE TABLE IF NOT EXISTS posizioni_stand (
  allegato_id   INTEGER NOT NULL REFERENCES allegati(id) ON DELETE CASCADE,
  chiave        TEXT    NOT NULL,
  pagina        INTEGER NOT NULL DEFAULT 1,
  x             REAL    NOT NULL,
  y             REAL    NOT NULL,
  aggiornato_il TEXT    NOT NULL,
  PRIMARY KEY (allegato_id, chiave)
);

CREATE INDEX IF NOT EXISTS idx_noleggi_prodotto ON noleggi(prodotto_id);
CREATE INDEX IF NOT EXISTS idx_noleggi_fiera    ON noleggi(fiera_id);
CREATE INDEX IF NOT EXISTS idx_noleggi_periodo  ON noleggi(data_inizio, data_fine);
`);

/**
 * Allinea un database creato con una versione precedente dello schema.
 * SQLite non ha "ADD COLUMN IF NOT EXISTS", quindi si controlla prima.
 */
function aggiungiColonna(tabella, colonna, definizione) {
  const presenti = db.prepare(`PRAGMA table_info(${tabella})`).all().map((c) => c.name);
  if (!presenti.includes(colonna)) {
    db.exec(`ALTER TABLE ${tabella} ADD COLUMN ${colonna} ${definizione}`);
    return true;
  }
  return false;
}

aggiungiColonna('fiere', 'manifestazione', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('fiere', 'anno', 'INTEGER');
// Per i dati creati prima di questa distinzione: l'anno si legge dalla data di
// inizio e la manifestazione dal nome, togliendogli l'anno finale.
db.exec(`
  UPDATE fiere
     SET anno = CAST(substr(data_inizio, 1, 4) AS INTEGER)
   WHERE anno IS NULL`);
db.exec(`
  UPDATE fiere
     SET manifestazione = TRIM(
           CASE WHEN nome LIKE '% 19__' OR nome LIKE '% 20__'
                THEN substr(nome, 1, length(nome) - 5)
                ELSE nome END)
   WHERE manifestazione = ''`);
db.exec('CREATE INDEX IF NOT EXISTS idx_fiere_manifestazione ON fiere(manifestazione, anno)');

aggiungiColonna('noleggi', 'cliente', "TEXT DEFAULT ''");
aggiungiColonna('noleggi', 'stand', "TEXT DEFAULT ''");
if (aggiungiColonna('noleggi', 'importo', 'REAL NOT NULL DEFAULT 0')) {
  // Le righe del vecchio schema avevano un prezzo al giorno: lo si converte
  // nell'importo complessivo moltiplicandolo per i giorni di noleggio.
  const colonne = db.prepare('PRAGMA table_info(noleggi)').all().map((c) => c.name);
  if (colonne.includes('prezzo_giorno')) {
    db.exec(`
      UPDATE noleggi
         SET importo = COALESCE(prezzo_giorno, 0) * quantita *
             (CAST(julianday(data_fine) - julianday(data_inizio) AS INTEGER) + 1)
       WHERE importo = 0`);
  }
}

// Costo d'acquisto, EAN e scheda tecnica (le misure servono agli allestitori).
const nuovoCosto = aggiungiColonna('prodotti', 'costo_acquisto', 'REAL NOT NULL DEFAULT 0');
aggiungiColonna('prodotti', 'ean', "TEXT DEFAULT ''");
aggiungiColonna('prodotti', 'larghezza_mm', 'REAL');
aggiungiColonna('prodotti', 'altezza_mm', 'REAL');
aggiungiColonna('prodotti', 'profondita_mm', 'REAL');
aggiungiColonna('prodotti', 'altezza_base_mm', 'REAL');
aggiungiColonna('prodotti', 'peso_kg', 'REAL');
aggiungiColonna('prodotti', 'vesa', "TEXT DEFAULT ''");
aggiungiColonna('prodotti', 'scheda_url', "TEXT DEFAULT ''");
if (nuovoCosto) {
  // L'importatore Airtable aveva messo il costo nelle note ("Costo d'acquisto:
  // 450 €") e l'EAN dentro il nome: si portano nei campi giusti.
  const RIGA_COSTO = /^Costo d'acquisto: ([\d.]+) €\n?/m;
  const aggiorna = db.prepare('UPDATE prodotti SET costo_acquisto = ?, ean = ?, note = ? WHERE id = ?');
  for (const p of db.prepare('SELECT id, nome, note, ean FROM prodotti').all()) {
    const costo = Number((p.note || '').match(RIGA_COSTO)?.[1] || 0);
    const ean = p.ean || (p.nome.match(/\b(\d{13}|\d{8})\b/)?.[1] ?? '');
    aggiorna.run(costo, ean, (p.note || '').replace(RIGA_COSTO, '').trim(), p.id);
  }
}

// Organizzatori di fiera: ognuno vede solo le manifestazioni che gli sono
// assegnate (es. Progecta → LTS e Pharmexpo) e da lì manda le richieste.
db.exec(`
CREATE TABLE IF NOT EXISTS accessi_fiera (
  utente_id      INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  manifestazione TEXT    NOT NULL COLLATE NOCASE,
  PRIMARY KEY (utente_id, manifestazione)
);

CREATE TABLE IF NOT EXISTS richieste (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fiera_id      INTEGER NOT NULL REFERENCES fiere(id) ON DELETE CASCADE,
  utente_id     INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
  espositore    TEXT    NOT NULL,
  stand         TEXT    DEFAULT '',
  referente     TEXT    DEFAULT '',
  righe         TEXT    NOT NULL,          -- JSON: [{ "tipo": "tv", "pollici": 65, "quantita": 2 }, …]
  note          TEXT    DEFAULT '',
  stato         TEXT    NOT NULL DEFAULT 'nuova', -- nuova | confermata | rifiutata | annullata
  risposta      TEXT    DEFAULT '',        -- motivo del rifiuto o nota di conferma
  noleggi       TEXT    DEFAULT '[]',      -- JSON: id dei noleggi creati alla conferma
  creato_il     TEXT    NOT NULL,
  aggiornato_il TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_richieste_fiera ON richieste(fiera_id, stato);
`);
// Come l'organizzatore vuole i monitor: parete, piantana, tavolo o misto.
aggiungiColonna('richieste', 'montaggio', "TEXT DEFAULT ''");

// Come si monta un apparecchio (a parete, su piantana, da tavolo) e le note
// per chi lo installa: le vede il tecnico, a differenza delle note normali.
aggiungiColonna('noleggi', 'note_tecnico', "TEXT DEFAULT ''");
if (aggiungiColonna('noleggi', 'montaggio', "TEXT DEFAULT ''")) {
  // Per lo storico: un TV in uno stand dove è noleggiata anche una piantana
  // va su piantana. Il resto resta "da definire".
  db.exec(`
    UPDATE noleggi SET montaggio = 'piantana'
     WHERE prodotto_id IN (SELECT id FROM prodotti WHERE categoria IN ('TV', 'Monitor'))
       AND EXISTS (
         SELECT 1 FROM noleggi p JOIN prodotti pp ON pp.id = p.prodotto_id
          WHERE p.fiera_id = noleggi.fiera_id AND p.id != noleggi.id
            AND pp.categoria = 'Supporto' AND lower(pp.nome) LIKE '%piantana%'
            AND lower(trim(p.cliente)) = lower(trim(noleggi.cliente))
            AND lower(trim(p.stand)) = lower(trim(noleggi.stand)))`);
}

// Listino: prezzo di un pezzo per una fiera (i noleggi si quotano così). Per
// partire si prende il prezzo più frequente nello storico dello stesso modello.
/**
 * Prezzo a fiera dei prodotti che non ce l'hanno: il più frequente nello
 * storico del modello. Lo usano la migrazione e l'importazione da Airtable.
 */
export function prezziDaStorico() {
  const storico = db.prepare(`
    SELECT p.nome, n.importo / n.quantita AS prezzo
      FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
     WHERE n.stato != 'annullato' AND n.importo > 0`).all();
  const perModello = new Map();
  for (const { nome, prezzo } of storico) {
    const conta = perModello.get(nome) || new Map();
    const tondo = Math.round(prezzo);
    conta.set(tondo, (conta.get(tondo) || 0) + 1);
    perModello.set(nome, conta);
  }
  const aggiorna = db.prepare('UPDATE prodotti SET prezzo_fiera = ? WHERE nome = ? AND prezzo_fiera IS NULL');
  let aggiornati = 0;
  for (const [nome, conta] of perModello) {
    // A parità di frequenza vince il prezzo più alto: meglio non svendere.
    const [prezzo] = [...conta].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    aggiornati += aggiorna.run(prezzo, nome).changes;
  }
  return aggiornati;
}
if (aggiungiColonna('prodotti', 'prezzo_fiera', 'REAL')) prezziDaStorico();

// Impostazioni dell'app (per ora l'intestazione dei documenti), chiave → JSON.
db.exec(`
CREATE TABLE IF NOT EXISTS impostazioni (
  chiave        TEXT PRIMARY KEY,
  valore        TEXT NOT NULL,
  aggiornato_il TEXT NOT NULL
);`);

// In Airtable i TV da 86" erano segnati con 85 pollici.
db.exec(`UPDATE prodotti SET pollici = 86 WHERE pollici = 85 AND nome LIKE '%86"%'`);

// Gli ID dei prodotti tornano quelli di Airtable (1, 2, 3…), senza "INV-".
db.exec("UPDATE prodotti SET codice = substr(codice, 5) WHERE codice GLOB 'INV-[0-9]*'");

export default db;
