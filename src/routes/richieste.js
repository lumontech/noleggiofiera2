// Le richieste degli organizzatori, lato amministratore: si confermano
// (diventano noleggi con gli apparecchi scelti) o si rifiutano con un motivo.

import { Router } from 'express';
import db from '../lib/db.js';
import { HttpError, testo, decimale, intero } from '../lib/domain.js';
import { verificaCapienza } from '../lib/disponibilita.js';
import { trovaRichiesta, proposta } from '../lib/richieste.js';
import { trovaFiera, finestraLogistica } from './fiere.js';
import { trovaProdotto } from './prodotti.js';

const router = Router();

const perElenco = (r) => ({
  ...r,
  righe: JSON.parse(r.righe),
  noleggi: JSON.parse(r.noleggi || '[]'),
});

router.get('/', (req, res) => {
  const righe = db.prepare(`
    SELECT r.*, u.nome AS autore_nome, f.nome AS fiera_nome, f.data_inizio AS fiera_inizio,
           f.data_fine AS fiera_fine
      FROM richieste r
      JOIN fiere f ON f.id = r.fiera_id
      LEFT JOIN utenti u ON u.id = r.utente_id
     ORDER BY CASE r.stato WHEN 'nuova' THEN 0 ELSE 1 END, f.data_inizio ASC, r.creato_il ASC`).all();
  res.json(righe.map(perElenco));
});

router.get('/:id/proposta', (req, res) => {
  const richiesta = trovaRichiesta(req.params.id);
  const fiera = trovaFiera(richiesta.fiera_id);
  res.json({ richiesta: perElenco(richiesta), fiera, righe: proposta(richiesta, fiera) });
});

function daGestire(id) {
  const richiesta = trovaRichiesta(id);
  if (richiesta.stato !== 'nuova') throw new HttpError(409, 'Questa richiesta è già stata gestita.');
  return richiesta;
}

/**
 * Conferma: un noleggio per ogni apparecchio scelto, alle date della fiera,
 * intestato all'espositore. L'importo totale si divide tra gli apparecchi.
 */
router.post('/:id/conferma', (req, res) => {
  const richiesta = daGestire(req.params.id);
  const fiera = trovaFiera(richiesta.fiera_id);
  const ids = [...new Set((Array.isArray(req.body?.apparecchi) ? req.body.apparecchi : [])
    .map((v) => intero(v, 'apparecchio', { min: 1 })))];
  if (!ids.length) throw new HttpError(400, 'Scegli almeno un apparecchio.');
  const totale = decimale(req.body?.importo, 'importo', { min: 0, predefinito: 0 });
  const nota = testo(req.body?.nota, 'nota', { max: 500 });
  const { from, to } = finestraLogistica(fiera);

  // In centesimi, così la somma delle quote torna esattamente al totale.
  const centesimi = Math.round(totale * 100);
  const quota = Math.floor(centesimi / ids.length);
  const adesso = new Date().toISOString();
  const noteNoleggio = [
    `Da richiesta di ${richiesta.autore_nome || 'organizzatore'}`,
    richiesta.referente && `Referente: ${richiesta.referente}`,
    richiesta.note,
  ].filter(Boolean).join('\n');

  const creati = db.transaction(() => ids.map((id, i) => {
    const prodotto = trovaProdotto(id);
    if (prodotto.stato !== 'attivo') throw new HttpError(409, `"${prodotto.nome}" non è disponibile (${prodotto.stato}).`);
    const esito = verificaCapienza({ prodotto, quantita: 1, from, to });
    if (!esito.ok) throw new HttpError(409, `"${prodotto.nome}" è già impegnato in quelle date: scegline un altro.`);
    const importo = (quota + (i === 0 ? centesimi - quota * ids.length : 0)) / 100;
    return db.prepare(`
      INSERT INTO noleggi (prodotto_id, fiera_id, cliente, stand, quantita, data_inizio, data_fine,
                           stato, importo, note, creato_il, aggiornato_il)
      VALUES (?, ?, ?, ?, 1, ?, ?, 'prenotato', ?, ?, ?, ?)`)
      .run(prodotto.id, fiera.id, richiesta.espositore, richiesta.stand, from, to, importo,
        noteNoleggio, adesso, adesso).lastInsertRowid;
  }))();

  db.prepare(`UPDATE richieste SET stato = 'confermata', risposta = ?, noleggi = ?, aggiornato_il = ?
               WHERE id = ?`).run(nota, JSON.stringify(creati), adesso, richiesta.id);
  res.json(perElenco(trovaRichiesta(richiesta.id)));
});

router.post('/:id/rifiuta', (req, res) => {
  const richiesta = daGestire(req.params.id);
  const motivo = testo(req.body?.motivo, 'motivo', { max: 500 });
  db.prepare("UPDATE richieste SET stato = 'rifiutata', risposta = ?, aggiornato_il = ? WHERE id = ?")
    .run(motivo, new Date().toISOString(), richiesta.id);
  res.json(perElenco(trovaRichiesta(richiesta.id)));
});

export default router;
