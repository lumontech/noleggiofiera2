// Utenti, ruoli e sessioni.
//
// Due ruoli:
//   amministratore → tutta l'app, prezzi e utenti compresi
//   tecnico        → solo cosa installare, dove e quando, con la pianta;
//                    nessun prezzo. Il tecnico ha un canale dati suo
//                    (/api/tecnico) che per costruzione non contiene prezzi;
//                    il resto dell'API gli è chiuso dal server.
//
// Al primo avvio, se non ci sono utenti, si crea l'amministratore "stefano"
// con la password di APP_PASSWORD, così chi già entrava continua a farlo.

import crypto from 'node:crypto';
import db from './db.js';
import { HttpError } from './domain.js';

export const RUOLI = ['amministratore', 'tecnico'];

const SEGRETO = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'nf_sessione';
const DURATA_MS = 1000 * 60 * 60 * 24 * 30; // 30 giorni
const SCRYPT = { N: 16384, r: 8, p: 1 };

/* ---------- password ---------- */

export function hashPassword(password) {
  const sale = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), sale, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${sale.toString('base64')}$${hash.toString('base64')}`;
}

function passwordCorretta(password, salvata) {
  const [algoritmo, n, sale, hash] = String(salvata || '').split('$');
  if (algoritmo !== 'scrypt' || !sale || !hash) return false;
  const atteso = Buffer.from(hash, 'base64');
  const calcolato = crypto.scryptSync(String(password), Buffer.from(sale, 'base64'), atteso.length,
    { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(atteso, calcolato);
}

// Hash di confronto per quando l'utente non esiste: la risposta impiega lo
// stesso tempo, così non si scopre quali nomi utente sono validi.
const HASH_FITTIZIO = hashPassword(crypto.randomBytes(8).toString('hex'));

/* ---------- primo avvio ---------- */

if (db.prepare('SELECT COUNT(*) AS n FROM utenti').get().n === 0) {
  const adesso = new Date().toISOString();
  db.prepare(`
    INSERT INTO utenti (nome, accesso, password_hash, ruolo, creato_il, aggiornato_il)
    VALUES ('Stefano', 'stefano', ?, 'amministratore', ?, ?)`)
    .run(hashPassword(process.env.APP_PASSWORD || 'noleggio2026'), adesso, adesso);
  console.log('Creato l\'utente amministratore "stefano" con la password di APP_PASSWORD.');
}

// Chi ha installato la versione precedente ha l'amministratore creato in
// automatico col nome "admin": diventa "stefano", password invariata. Solo se
// è ancora quello creato in automatico e "stefano" non esiste già.
db.prepare(`
  UPDATE utenti SET accesso = 'stefano', nome = 'Stefano', aggiornato_il = ?
   WHERE accesso = 'admin' AND nome = 'Amministratore'
     AND NOT EXISTS (SELECT 1 FROM utenti WHERE accesso = 'stefano')`).run(new Date().toISOString());

/* ---------- limite ai tentativi ---------- */

// Dopo 5 errori sullo stesso nome utente dallo stesso indirizzo, attesa di 5
// minuti che raddoppia a ogni nuovo errore (massimo un'ora). Rende inutile
// provare le password a raffica, anche quelle corte.
const tentativi = new Map();
const ERRORI_PERMESSI = 5;

function chiaveTentativi(req, nome) {
  return `${req.ip}|${String(nome || '').toLowerCase()}`;
}

function controllaBlocco(chiave) {
  const t = tentativi.get(chiave);
  if (t?.bloccatoFino && t.bloccatoFino > Date.now()) {
    const minuti = Math.ceil((t.bloccatoFino - Date.now()) / 60000);
    throw new HttpError(429,
      `Troppi tentativi sbagliati. Riprova tra ${minuti} ${minuti === 1 ? 'minuto' : 'minuti'}.`);
  }
}

function registraErrore(chiave) {
  const t = tentativi.get(chiave) || { errori: 0, bloccatoFino: 0 };
  t.errori += 1;
  if (t.errori >= ERRORI_PERMESSI) {
    const volte = t.errori - ERRORI_PERMESSI;
    t.bloccatoFino = Date.now() + Math.min(5 * 60000 * 2 ** volte, 60 * 60000);
  }
  tentativi.set(chiave, t);
  // Pulizia: la mappa non deve crescere all'infinito.
  if (tentativi.size > 5000) {
    for (const [k, v] of tentativi) if (!v.bloccatoFino || v.bloccatoFino < Date.now()) tentativi.delete(k);
  }
}

/* ---------- sessione ---------- */

function firma(testo) {
  return crypto.createHmac('sha256', SEGRETO).update(testo).digest('base64url');
}

function creaToken(utente) {
  const dati = Buffer.from(JSON.stringify({
    u: utente.id, v: utente.versione_sessione, e: Date.now() + DURATA_MS,
  })).toString('base64url');
  return `${dati}.${firma(dati)}`;
}

/**
 * L'utente di una sessione, se valida. Si ricontrolla a ogni richiesta che
 * sia ancora attivo e che la sessione non sia stata revocata (cambio password,
 * disattivazione, cambio di ruolo): l'effetto è immediato, non alla scadenza.
 */
function utenteDelToken(token) {
  const [dati, hash] = String(token || '').split('.');
  if (!dati || !hash) return null;
  const atteso = firma(dati);
  if (hash.length !== atteso.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(atteso))) return null;
  let contenuto;
  try { contenuto = JSON.parse(Buffer.from(dati, 'base64url').toString('utf8')); } catch { return null; }
  if (!contenuto.e || contenuto.e < Date.now()) return null;
  const utente = db.prepare('SELECT * FROM utenti WHERE id = ?').get(contenuto.u);
  if (!utente || !utente.attivo || utente.versione_sessione !== contenuto.v) return null;
  return utente;
}

export const perSessione = (u) => ({ id: u.id, nome: u.nome, accesso: u.accesso, ruolo: u.ruolo });

export function accedi(req, res) {
  // Chi arriva dal vecchio modulo con la sola password entra come il primo amministratore.
  const nome = String(req.body?.utente ?? (db.prepare(`SELECT accesso FROM utenti
    WHERE ruolo = 'amministratore' AND attivo = 1 ORDER BY id LIMIT 1`).get()?.accesso || '')).trim();
  const chiave = chiaveTentativi(req, nome);
  controllaBlocco(chiave);

  const utente = db.prepare('SELECT * FROM utenti WHERE accesso = ?').get(nome);
  const corretta = passwordCorretta(req.body?.password, utente?.password_hash || HASH_FITTIZIO);
  if (!utente || !corretta || !utente.attivo) {
    registraErrore(chiave);
    throw new HttpError(401, utente && corretta && !utente.attivo
      ? 'Questo utente è stato disattivato.'
      : 'Nome utente o password non corretti.');
  }
  tentativi.delete(chiave);
  db.prepare('UPDATE utenti SET ultimo_accesso = ? WHERE id = ?').run(new Date().toISOString(), utente.id);
  apriSessione(req, res, utente);
  return { ok: true, utente: perSessione(utente) };
}

/** Imposta il cookie di sessione per un utente (accesso, o rinnovo dopo un cambio password). */
export function apriSessione(req, res, utente) {
  const aggiornato = db.prepare('SELECT * FROM utenti WHERE id = ?').get(utente.id);
  res.cookie(COOKIE, creaToken(aggiornato), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: DURATA_MS,
    secure: req.secure,
  });
}

export function esci(_req, res) {
  res.clearCookie(COOKIE);
  return { ok: true };
}

export function sessione(req) {
  const utente = utenteDelToken(req.cookies?.[COOKIE]);
  return utente ? { autenticato: true, utente: perSessione(utente) } : { autenticato: false };
}

export function richiediAutenticazione(req, _res, next) {
  const utente = utenteDelToken(req.cookies?.[COOKIE]);
  if (!utente) return next(new HttpError(401, 'Sessione scaduta: effettua di nuovo l\'accesso.'));
  req.utente = utente;
  return next();
}

export function soloAmministratore(req, _res, next) {
  if (req.utente?.ruolo !== 'amministratore') {
    return next(new HttpError(403, 'Questa parte è riservata agli amministratori.'));
  }
  return next();
}

/** Per revocare le sessioni aperte di un utente (cambio password, ruolo, disattivazione). */
export function revocaSessioni(utenteId) {
  db.prepare('UPDATE utenti SET versione_sessione = versione_sessione + 1 WHERE id = ?').run(utenteId);
}

export { passwordCorretta };
