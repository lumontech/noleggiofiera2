// Il canale dati del tecnico: cosa installare, dove e quando, con le
// planimetrie. Nessun prezzo.
//
// Ogni campo che esce da qui è scelto per nome (niente SELECT *, niente
// oggetti passati interi): se un domani si aggiunge al database una colonna con
// un importo, al tecnico non arriva. Le note libere restano fuori perché
// potrebbero contenere un prezzo scritto a mano.
//
// Il tecnico vede le edizioni in cui c'è materiale da installare o ancora
// installato (noleggi prenotati o consegnati): quando tutto è rientrato,
// l'edizione sparisce dalla sua lista.

import { Router } from 'express';
import db from '../lib/db.js';
import { HttpError, STATI_IMPEGNATIVI, giorniTra } from '../lib/domain.js';
import * as archivio from '../lib/allegati.js';

const router = Router();
const SEGNAPOSTO = STATI_IMPEGNATIVI.map(() => '?').join(',');

const fieraPerTecnico = (f) => ({
  id: f.id,
  nome: f.nome,
  manifestazione: f.manifestazione,
  anno: f.anno,
  luogo: f.luogo,
  citta: f.citta,
  padiglione: f.padiglione,
  data_inizio: f.data_inizio,
  data_fine: f.data_fine,
  giorni_allestimento: f.giorni_allestimento,
  giorni_smontaggio: f.giorni_smontaggio,
  durata_giorni: giorniTra(f.data_inizio, f.data_fine),
});

const installazionePerTecnico = (n) => ({
  id: n.id,
  cliente: n.cliente,
  stand: n.stand,
  quantita: n.quantita,
  data_inizio: n.data_inizio,
  data_fine: n.data_fine,
  stato: n.stato,
  prodotto_nome: n.prodotto_nome,
  prodotto_marca: n.prodotto_marca,
  prodotto_pollici: n.prodotto_pollici,
  prodotto_codice: n.prodotto_codice,
  prodotto_categoria: n.prodotto_categoria,
});

const allegatoPerTecnico = (a, fieraId) => ({
  id: a.id,
  nome: a.nome_originale,
  tipo: a.tipo,
  url: `/api/tecnico/fiere/${fieraId}/allegati/${a.id}`,
});

function installazioniDella(fieraId) {
  return db.prepare(`
    SELECT n.id, n.cliente, n.stand, n.quantita, n.data_inizio, n.data_fine, n.stato,
           p.nome AS prodotto_nome, p.marca AS prodotto_marca, p.pollici AS prodotto_pollici,
           p.codice AS prodotto_codice, p.categoria AS prodotto_categoria
      FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
     WHERE n.fiera_id = ? AND n.stato IN (${SEGNAPOSTO})
     ORDER BY n.stand, n.cliente`).all(fieraId, ...STATI_IMPEGNATIVI).map(installazionePerTecnico);
}

function allegatiDella(fieraId) {
  return db.prepare('SELECT id, nome_originale, tipo FROM allegati WHERE fiera_id = ? ORDER BY creato_il DESC')
    .all(fieraId).map((a) => allegatoPerTecnico(a, fieraId));
}

/** Un'edizione visibile al tecnico: esiste e ha materiale da installare o installato. */
function fieraVisibile(id) {
  const fiera = db.prepare(`
    SELECT f.* FROM fiere f
     WHERE f.id = ? AND EXISTS (SELECT 1 FROM noleggi n WHERE n.fiera_id = f.id AND n.stato IN (${SEGNAPOSTO}))`)
    .get(id, ...STATI_IMPEGNATIVI);
  if (!fiera) throw new HttpError(404, 'Nessuna installazione su questa fiera.');
  return fiera;
}

router.get('/installazioni', (_req, res) => {
  const fiere = db.prepare(`
    SELECT f.* FROM fiere f
     WHERE EXISTS (SELECT 1 FROM noleggi n WHERE n.fiera_id = f.id AND n.stato IN (${SEGNAPOSTO}))
     ORDER BY f.data_inizio ASC`).all(...STATI_IMPEGNATIVI);
  res.json(fiere.map((f) => ({
    ...fieraPerTecnico(f),
    installazioni: installazioniDella(f.id),
    allegati: allegatiDella(f.id),
  })));
});

router.get('/fiere/:id', (req, res) => {
  const fiera = fieraVisibile(req.params.id);
  res.json({ ...fieraPerTecnico(fiera), noleggi: installazioniDella(fiera.id), allegati: allegatiDella(fiera.id) });
});

function allegatoVisibile(req) {
  const fiera = fieraVisibile(req.params.id);
  const allegato = db.prepare('SELECT * FROM allegati WHERE id = ? AND fiera_id = ?').get(req.params.allegato, fiera.id);
  if (!allegato) throw new HttpError(404, 'Planimetria non trovata.');
  return { fiera, allegato };
}

router.get('/fiere/:id/allegati/:allegato', (req, res) => {
  const { fiera, allegato } = allegatoVisibile(req);
  archivio.invia(res, fiera.id, allegato);
});

router.get('/fiere/:id/allegati/:allegato/posizioni', (req, res) => {
  const { allegato } = allegatoVisibile(req);
  res.json(db.prepare('SELECT chiave, pagina, x, y FROM posizioni_stand WHERE allegato_id = ?').all(allegato.id));
});

export default router;
