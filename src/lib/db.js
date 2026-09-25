import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
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
  quantita      INTEGER NOT NULL DEFAULT 1,
  data_inizio   TEXT    NOT NULL,
  data_fine     TEXT    NOT NULL,
  stato         TEXT    NOT NULL DEFAULT 'prenotato',
  prezzo_giorno REAL,
  note          TEXT    DEFAULT '',
  creato_il     TEXT    NOT NULL,
  aggiornato_il TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_noleggi_prodotto ON noleggi(prodotto_id);
CREATE INDEX IF NOT EXISTS idx_noleggi_fiera    ON noleggi(fiera_id);
CREATE INDEX IF NOT EXISTS idx_noleggi_periodo  ON noleggi(data_inizio, data_fine);
`);

export default db;
