import { Router } from 'express';
import db from '../lib/db.js';
import { HttpError, testo, enumerato } from '../lib/domain.js';
import {
  RUOLI, hashPassword, passwordCorretta, revocaSessioni, perSessione, apriSessione,
} from '../lib/auth.js';

export const MINIMO_PASSWORD = 4;

const router = Router();

const manifestazioniDi = (id) => db.prepare(
  'SELECT manifestazione FROM accessi_fiera WHERE utente_id = ? ORDER BY manifestazione').all(id)
  .map((r) => r.manifestazione);

const perElenco = (u) => ({
  id: u.id,
  nome: u.nome,
  accesso: u.accesso,
  ruolo: u.ruolo,
  manifestazioni: manifestazioniDi(u.id),
  attivo: Boolean(u.attivo),
  ultimo_accesso: u.ultimo_accesso,
  creato_il: u.creato_il,
});

function trovaUtente(id) {
  const utente = db.prepare('SELECT * FROM utenti WHERE id = ?').get(id);
  if (!utente) throw new HttpError(404, 'Utente non trovato.');
  return utente;
}

function password(valore, campo = 'password') {
  const p = String(valore ?? '');
  if (p.length < MINIMO_PASSWORD) {
    throw new HttpError(400, `La ${campo} deve avere almeno ${MINIMO_PASSWORD} caratteri.`);
  }
  if (p.length > 200) throw new HttpError(400, `La ${campo} è troppo lunga.`);
  return p;
}

function nomeAccesso(valore) {
  const v = testo(valore, 'nome utente', { obbligatorio: true, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(v)) {
    throw new HttpError(400, 'Il nome utente può contenere lettere, numeri, punto, trattino e _ (almeno 3 caratteri).');
  }
  return v;
}

/**
 * Le fiere di un organizzatore: almeno una, e devono esistere. Si salvano col
 * nome scritto come nelle fiere, così "pharmexpo" diventa "Pharmexpo".
 */
function leggiManifestazioni(valore, ruolo) {
  if (ruolo !== 'organizzatore') return [];
  const nomi = [...new Set((Array.isArray(valore) ? valore : []).map((v) => String(v).trim()).filter(Boolean))];
  if (!nomi.length) throw new HttpError(400, 'Scegli almeno una fiera per l\'organizzatore.');
  return nomi.map((nome) => {
    const esistente = db.prepare('SELECT manifestazione FROM fiere WHERE manifestazione = ? COLLATE NOCASE LIMIT 1').get(nome);
    if (!esistente) throw new HttpError(400, `La fiera "${nome}" non esiste.`);
    return esistente.manifestazione;
  });
}

function salvaManifestazioni(utenteId, nomi) {
  db.prepare('DELETE FROM accessi_fiera WHERE utente_id = ?').run(utenteId);
  const inserisci = db.prepare('INSERT OR IGNORE INTO accessi_fiera (utente_id, manifestazione) VALUES (?, ?)');
  for (const nome of nomi) inserisci.run(utenteId, nome);
}

// Deve restare sempre almeno un amministratore attivo, o nessuno potrebbe più gestire l'app.
function amministratoriAttiviEscluso(id) {
  return db.prepare(`SELECT COUNT(*) AS n FROM utenti
                      WHERE ruolo = 'amministratore' AND attivo = 1 AND id != ?`).get(id).n;
}

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM utenti ORDER BY ruolo, nome COLLATE NOCASE').all().map(perElenco));
});

router.post('/', (req, res) => {
  req.body = req.body || {};
  const dati = {
    nome: testo(req.body.nome, 'nome', { obbligatorio: true, max: 80 }),
    accesso: nomeAccesso(req.body.accesso),
    ruolo: enumerato(req.body.ruolo, 'ruolo', RUOLI, 'tecnico'),
    password_hash: hashPassword(password(req.body.password)),
  };
  if (db.prepare('SELECT 1 FROM utenti WHERE accesso = ?').get(dati.accesso)) {
    throw new HttpError(409, `Il nome utente "${dati.accesso}" è già usato.`);
  }
  const manifestazioni = leggiManifestazioni(req.body.manifestazioni, dati.ruolo);
  const adesso = new Date().toISOString();
  const info = db.transaction(() => {
    const esito = db.prepare(`
      INSERT INTO utenti (nome, accesso, password_hash, ruolo, creato_il, aggiornato_il)
      VALUES (@nome, @accesso, @password_hash, @ruolo, @adesso, @adesso)`).run({ ...dati, adesso });
    salvaManifestazioni(esito.lastInsertRowid, manifestazioni);
    return esito;
  })();
  res.status(201).json(perElenco(trovaUtente(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const utente = trovaUtente(req.params.id);
  const io = req.utente.id === utente.id;
  // I campi non inviati restano com'erano: si può anche solo disattivare.
  const corpo = req.body || {};
  const dati = {
    nome: corpo.nome === undefined ? utente.nome : testo(corpo.nome, 'nome', { obbligatorio: true, max: 80 }),
    accesso: corpo.accesso === undefined ? utente.accesso : nomeAccesso(corpo.accesso),
    ruolo: enumerato(corpo.ruolo, 'ruolo', RUOLI, utente.ruolo),
    attivo: corpo.attivo === undefined ? Boolean(utente.attivo)
      : corpo.attivo === true || corpo.attivo === 'true' || corpo.attivo === 'on',
  };
  const nuovaPassword = corpo.password ? password(corpo.password) : null;
  // Le fiere si riscrivono se arrivano, o se cambia il ruolo.
  const manifestazioni = corpo.manifestazioni !== undefined || dati.ruolo !== utente.ruolo
    ? leggiManifestazioni(corpo.manifestazioni ?? manifestazioniDi(utente.id), dati.ruolo)
    : null;

  if (io && !dati.attivo) throw new HttpError(409, 'Non puoi disattivare il tuo stesso utente.');
  if (io && dati.ruolo !== 'amministratore') throw new HttpError(409, 'Non puoi togliere a te stesso il ruolo di amministratore.');
  const restaAmministratore = dati.ruolo === 'amministratore' && dati.attivo;
  if (utente.ruolo === 'amministratore' && !restaAmministratore && amministratoriAttiviEscluso(utente.id) === 0) {
    throw new HttpError(409, 'Deve restare almeno un amministratore attivo.');
  }
  const altro = db.prepare('SELECT id FROM utenti WHERE accesso = ? AND id != ?').get(dati.accesso, utente.id);
  if (altro) throw new HttpError(409, `Il nome utente "${dati.accesso}" è già usato.`);

  db.prepare(`
    UPDATE utenti SET nome = @nome, accesso = @accesso, ruolo = @ruolo, attivo = @attivo,
                      aggiornato_il = @adesso
     WHERE id = @id`).run({ ...dati, attivo: dati.attivo ? 1 : 0, id: utente.id, adesso: new Date().toISOString() });
  if (nuovaPassword) {
    db.prepare('UPDATE utenti SET password_hash = ? WHERE id = ?').run(hashPassword(nuovaPassword), utente.id);
  }
  if (manifestazioni) salvaManifestazioni(utente.id, manifestazioni);
  // Nuova password, ruolo cambiato o utente disattivato: le sessioni aperte
  // su altri dispositivi non devono restare valide con i vecchi permessi.
  if (nuovaPassword || dati.ruolo !== utente.ruolo || !dati.attivo) {
    revocaSessioni(utente.id);
    if (io) apriSessione(req, res, utente);
  }
  res.json(perElenco(trovaUtente(utente.id)));
});

router.delete('/:id', (req, res) => {
  const utente = trovaUtente(req.params.id);
  if (req.utente.id === utente.id) throw new HttpError(409, 'Non puoi eliminare il tuo stesso utente.');
  if (utente.ruolo === 'amministratore' && amministratoriAttiviEscluso(utente.id) === 0) {
    throw new HttpError(409, 'Deve restare almeno un amministratore attivo.');
  }
  db.prepare('DELETE FROM utenti WHERE id = ?').run(utente.id);
  res.json({ ok: true });
});

export default router;

/** Cambio della propria password: disponibile a ogni ruolo. */
export const profilo = Router();
profilo.post('/password', (req, res) => {
  const utente = trovaUtente(req.utente.id);
  if (!passwordCorretta(req.body?.attuale, utente.password_hash)) {
    throw new HttpError(400, 'La password attuale non è corretta.');
  }
  const nuova = password(req.body?.nuova, 'nuova password');
  db.prepare('UPDATE utenti SET password_hash = ?, aggiornato_il = ? WHERE id = ?')
    .run(hashPassword(nuova), new Date().toISOString(), utente.id);
  // Le altre sessioni si chiudono; questa resta aperta con un token nuovo.
  revocaSessioni(utente.id);
  apriSessione(req, res, utente);
  res.json({ ok: true, utente: perSessione(utente) });
});
