// Le richieste degli organizzatori, lato amministratore: si confermano
// (diventano noleggi con gli apparecchi scelti) o si rifiutano con un motivo.

import { Router } from 'express';
import db from '../lib/db.js';
import { HttpError, testo, decimale, intero, enumerato, MONTAGGI } from '../lib/domain.js';
import { verificaCapienza } from '../lib/disponibilita.js';
import { trovaRichiesta, proposta, rigaCompleta } from '../lib/richieste.js';
import { trovaFiera, finestraLogistica } from './fiere.js';
import { trovaProdotto } from './prodotti.js';
import { sincronizzaPiantane, avvisoPiantane, portataPiantana } from '../lib/piantane.js';

const router = Router();

const perElenco = (r) => ({
  ...r,
  righe: JSON.parse(r.righe).map(rigaCompleta),
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
  // Ogni apparecchio con il suo montaggio: [{ id, montaggio }] (o solo l'id).
  const scelti = (Array.isArray(req.body?.apparecchi) ? req.body.apparecchi : []).map((v) => (
    typeof v === 'object' && v !== null
      ? { id: intero(v.id, 'apparecchio', { min: 1 }), montaggio: enumerato(v.montaggio, 'montaggio', MONTAGGI, '') }
      : { id: intero(v, 'apparecchio', { min: 1 }), montaggio: '' }));
  const ids = scelti.map((s) => s.id);
  if (!ids.length) throw new HttpError(400, 'Scegli almeno un apparecchio.');
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Lo stesso apparecchio è scelto due volte.');
  const noteTecnico = testo(req.body?.note_tecnico, 'note per il tecnico', { max: 500 });
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

  const SCHERMI = ['TV', 'Monitor', 'Videowall', 'Totem'];
  const esitoPiantane = { create: 0, mancanti: 0 };
  const creati = db.transaction(() => {
    const righe = scelti.map(({ id, montaggio }, i) => {
      const prodotto = trovaProdotto(id);
      if (prodotto.stato !== 'attivo') throw new HttpError(409, `"${prodotto.nome}" non è disponibile (${prodotto.stato}).`);
      const esito = verificaCapienza({ prodotto, quantita: 1, from, to });
      if (!esito.ok) throw new HttpError(409, `"${prodotto.nome}" è già impegnato in quelle date: scegline un altro.`);
      const importo = (quota + (i === 0 ? centesimi - quota * ids.length : 0)) / 100;
      const nuovo = db.prepare(`
        INSERT INTO noleggi (prodotto_id, fiera_id, cliente, stand, padiglione, quantita, data_inizio, data_fine,
                             stato, importo, note, montaggio, note_tecnico, creato_il, aggiornato_il)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'prenotato', ?, ?, ?, ?, ?, ?)`)
        .run(prodotto.id, fiera.id, richiesta.espositore, richiesta.stand, richiesta.padiglione || '', from, to, importo,
          noteNoleggio, montaggio, noteTecnico, adesso, adesso).lastInsertRowid;
      return { id: nuovo, prodotto, montaggio };
    });

    // Le piantane scelte insieme ai TV "su piantana" diventano le loro: così
    // non se ne aggiungono altre. Ai TV che restano senza se ne abbina una libera.
    const piantane = righe.filter((r) => r.prodotto.categoria === 'Supporto' && /piantana/i.test(r.prodotto.nome));
    const tv = righe.filter((r) => SCHERMI.includes(r.prodotto.categoria) && r.montaggio === 'piantana');
    for (const t of tv) {
      const adatta = (p) => {
        const portata = portataPiantana(p.prodotto.nome);
        return !portata || !t.prodotto.pollici
          || (t.prodotto.pollici >= portata[0] - 1 && t.prodotto.pollici <= portata[1] + 1);
      };
      const i = piantane.findIndex(adatta);
      if (i >= 0) {
        db.prepare('UPDATE noleggi SET abbinato_a = ? WHERE id = ?').run(t.id, piantane[i].id);
        piantane.splice(i, 1);
      }
    }
    for (const t of tv) {
      const r = sincronizzaPiantane(t.id);
      esitoPiantane.create += r.create;
      esitoPiantane.mancanti += r.mancanti;
    }
    return righe.map((r) => r.id);
  })();

  db.prepare(`UPDATE richieste SET stato = 'confermata', risposta = ?, noleggi = ?, aggiornato_il = ?
               WHERE id = ?`).run(nota, JSON.stringify(creati), adesso, richiesta.id);
  res.json({ ...perElenco(trovaRichiesta(richiesta.id)), avviso: avvisoPiantane(esitoPiantane) });
});

router.post('/:id/rifiuta', (req, res) => {
  const richiesta = daGestire(req.params.id);
  const motivo = testo(req.body?.motivo, 'motivo', { max: 500 });
  db.prepare("UPDATE richieste SET stato = 'rifiutata', risposta = ?, aggiornato_il = ? WHERE id = ?")
    .run(motivo, new Date().toISOString(), richiesta.id);
  res.json(perElenco(trovaRichiesta(richiesta.id)));
});

export default router;
