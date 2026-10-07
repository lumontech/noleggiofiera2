// Il canale dell'organizzatore di fiera: le sue edizioni in programma, cosa
// può chiedere (con quanti apparecchi sono liberi) e le richieste mandate.
// Nessun prezzo, nessun importo, nessuna fiera che non sia sua.

import { Router } from 'express';
import db from '../lib/db.js';
import { HttpError, intero, oggi } from '../lib/domain.js';
import {
  catalogo, leggiRichiesta, perOrganizzatore, trovaRichiesta, tipoDi, etichettaRiga,
} from '../lib/richieste.js';

const router = Router();

/** Le manifestazioni che l'utente può vedere (l'amministratore tutte). */
function manifestazioniDi(utente) {
  if (utente.ruolo === 'amministratore') {
    return db.prepare("SELECT DISTINCT manifestazione FROM fiere WHERE manifestazione != ''").all()
      .map((r) => r.manifestazione);
  }
  return db.prepare('SELECT manifestazione FROM accessi_fiera WHERE utente_id = ?').all(utente.id)
    .map((r) => r.manifestazione);
}

/** Le edizioni in programma delle sue manifestazioni. */
function fiereDi(utente) {
  const nomi = manifestazioniDi(utente);
  if (!nomi.length) return [];
  return db.prepare(`
    SELECT * FROM fiere
     WHERE manifestazione COLLATE NOCASE IN (${nomi.map(() => '?').join(',')})
       AND data_fine >= ? AND stato NOT IN ('annullata', 'conclusa')
     ORDER BY data_inizio ASC`).all(...nomi, oggi());
}

function fieraConsentita(utente, id) {
  const fiera = fiereDi(utente).find((f) => f.id === Number(id));
  if (!fiera) throw new HttpError(404, 'Fiera non trovata tra le tue fiere in programma.');
  return fiera;
}

const fieraPerOrganizzatore = (f) => ({
  id: f.id,
  nome: f.nome,
  manifestazione: f.manifestazione,
  anno: f.anno,
  luogo: f.luogo,
  citta: f.citta,
  data_inizio: f.data_inizio,
  data_fine: f.data_fine,
});

function richiesteDella(fieraId) {
  return db.prepare(`
    SELECT r.*, u.nome AS autore_nome FROM richieste r LEFT JOIN utenti u ON u.id = r.utente_id
     WHERE r.fiera_id = ? AND r.stato != 'annullata'
     ORDER BY r.creato_il DESC`).all(fieraId).map(perOrganizzatore);
}

/** Cosa è già confermato sulla fiera, per espositore e stand: senza importi. */
function confermatiDella(fieraId) {
  const righe = db.prepare(`
    SELECT n.cliente, n.stand, n.padiglione, n.quantita, n.stato, p.categoria, p.pollici, p.nome
      FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
     WHERE n.fiera_id = ? AND n.stato IN ('prenotato', 'consegnato')
     ORDER BY n.cliente, n.stand`).all(fieraId);
  const gruppi = new Map();
  for (const r of righe) {
    const chiave = `${r.cliente}|${r.padiglione || ''}|${r.stand}`;
    if (!gruppi.has(chiave)) gruppi.set(chiave, { espositore: r.cliente, stand: r.stand, padiglione: r.padiglione || '', apparecchi: {} });
    const tipo = tipoDi(r);
    const nome = tipo ? etichettaRiga(tipo) : r.categoria;
    const g = gruppi.get(chiave);
    g.apparecchi[nome] = (g.apparecchi[nome] || 0) + r.quantita;
  }
  return [...gruppi.values()].map((g) => ({
    ...g,
    apparecchi: Object.entries(g.apparecchi).map(([nome, quantita]) => ({ nome, quantita })),
  }));
}

router.get('/fiere', (req, res) => {
  res.json({
    manifestazioni: manifestazioniDi(req.utente),
    fiere: fiereDi(req.utente).map((f) => ({
      ...fieraPerOrganizzatore(f),
      catalogo: catalogo(f),
      richieste: richiesteDella(f.id),
      confermati: confermatiDella(f.id),
    })),
  });
});

router.post('/richieste', (req, res) => {
  const fiera = fieraConsentita(req.utente, intero(req.body?.fiera_id, 'fiera', { min: 1 }));
  const dati = leggiRichiesta(req.body || {});
  const adesso = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO richieste (fiera_id, utente_id, espositore, stand, padiglione, referente, righe, note, montaggio,
                           creato_il, aggiornato_il)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(fiera.id, req.utente.id, dati.espositore, dati.stand, dati.padiglione, dati.referente,
      JSON.stringify(dati.righe), dati.note, dati.montaggio, adesso, adesso);
  res.status(201).json(perOrganizzatore(trovaRichiesta(info.lastInsertRowid)));
});

// Si può ritirare una richiesta finché non è stata gestita.
router.delete('/richieste/:id', (req, res) => {
  const richiesta = trovaRichiesta(req.params.id);
  fieraConsentita(req.utente, richiesta.fiera_id);
  if (richiesta.stato !== 'nuova') {
    throw new HttpError(409, 'La richiesta è già stata gestita: per cambiarla contatta chi noleggia i monitor.');
  }
  db.prepare("UPDATE richieste SET stato = 'annullata', aggiornato_il = ? WHERE id = ?")
    .run(new Date().toISOString(), richiesta.id);
  res.json({ ok: true });
});

export default router;
