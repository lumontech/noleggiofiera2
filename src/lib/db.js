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

export default db;
