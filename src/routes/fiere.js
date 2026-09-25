import { Router } from 'express';
import db from '../lib/db.js';
import {
  STATI_FIERA, HttpError,
  testo, intero, enumerato, periodo, addGiorni, giorniTra, oggi,
} from '../lib/domain.js';

const router = Router();

function leggiCorpo(body) {
  const { inizio, fine } = periodo(body);
  const manifestazione = testo(body.manifestazione, 'manifestazione', { obbligatorio: true, max: 120 });
  const anno = intero(body.anno, 'anno', { min: 2000, max: 2100, predefinito: Number(inizio.slice(0, 4)) });
  return {
    manifestazione,
    anno,
    // Il nome mostrato: se non lo scrivi, è "manifestazione + anno".
    nome: testo(body.nome, 'nome', { max: 120 }) || `${manifestazione} ${anno}`,
    cliente: testo(body.cliente, 'cliente', { max: 120 }),
    luogo: testo(body.luogo, 'luogo', { max: 120 }),
    citta: testo(body.citta, 'citta', { max: 80 }),
    padiglione: testo(body.padiglione, 'padiglione', { max: 40 }),
    stand: testo(body.stand, 'stand', { max: 40 }),
    data_inizio: inizio,
    data_fine: fine,
    giorni_allestimento: intero(body.giorni_allestimento, 'giorni_allestimento', { min: 0, max: 60, predefinito: 1 }),
    giorni_smontaggio: intero(body.giorni_smontaggio, 'giorni_smontaggio', { min: 0, max: 60, predefinito: 1 }),
    stato: enumerato(body.stato, 'stato', STATI_FIERA, 'pianificata'),
    note: testo(body.note, 'note', { max: 2000 }),
  };
}

export function trovaFiera(id) {
  const fiera = db.prepare('SELECT * FROM fiere WHERE id = ?').get(id);
  if (!fiera) throw new HttpError(404, 'Fiera non trovata.');
  return fiera;
}

// Finestra di occupazione reale: giorni di allestimento prima e smontaggio dopo.
export function finestraLogistica(fiera) {
  return {
    from: addGiorni(fiera.data_inizio, -fiera.giorni_allestimento),
    to: addGiorni(fiera.data_fine, fiera.giorni_smontaggio),
  };
}

function riepilogo(fiera) {
  const righe = db.prepare(`
    SELECT n.*, p.nome AS prodotto_nome, p.categoria AS prodotto_categoria,
           p.pollici AS prodotto_pollici
      FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
     WHERE n.fiera_id = ? ORDER BY p.categoria, p.nome`).all(fiera.id);
  const attivi = righe.filter((r) => r.stato !== 'annullato');
  const valore = attivi.reduce((tot, r) => tot + (r.importo ?? 0), 0);
  // Le edizioni passate della stessa manifestazione: servono a preparare
  // quella nuova sapendo cosa era stato noleggiato le volte precedenti.
  const precedenti = db.prepare(`
    SELECT f.id, f.nome, f.anno, f.data_inizio, f.data_fine,
           (SELECT COALESCE(SUM(n.quantita), 0) FROM noleggi n
             WHERE n.fiera_id = f.id AND n.stato != 'annullato') AS pezzi,
           (SELECT COALESCE(SUM(n.importo), 0) FROM noleggi n
             WHERE n.fiera_id = f.id AND n.stato != 'annullato') AS valore,
           (SELECT COUNT(DISTINCT n.cliente) FROM noleggi n
             WHERE n.fiera_id = f.id AND n.stato != 'annullato' AND n.cliente != '') AS clienti
      FROM fiere f
     WHERE f.manifestazione = ? AND f.id != ?
     ORDER BY f.anno DESC`).all(fiera.manifestazione, fiera.id);

  return {
    ...fiera,
    ...finestraLogistica(fiera),
    altre_edizioni: precedenti.map((e) => ({ ...e, valore: Math.round(e.valore * 100) / 100 })),
    durata_giorni: giorniTra(fiera.data_inizio, fiera.data_fine),
    pezzi_totali: attivi.reduce((tot, r) => tot + r.quantita, 0),
    righe_noleggio: attivi.length,
    clienti: new Set(attivi.map((r) => r.cliente).filter(Boolean)).size,
    valore: Math.round(valore * 100) / 100,
  };
}

router.get('/', (req, res) => {
  const { stato, q } = req.query;
  const condizioni = [];
  const parametri = [];
  if (stato) { condizioni.push('stato = ?'); parametri.push(stato); }
  if (q) {
    condizioni.push('(nome LIKE ? OR manifestazione LIKE ? OR citta LIKE ? OR luogo LIKE ?)');
    const like = `%${q}%`;
    parametri.push(like, like, like, like);
  }
  let sql = 'SELECT * FROM fiere';
  if (condizioni.length) sql += ` WHERE ${condizioni.join(' AND ')}`;
  sql += ` ORDER BY (data_fine >= date('now')) DESC,
                    CASE WHEN data_fine >= date('now') THEN data_inizio END ASC,
                    data_inizio DESC`;
  res.json(db.prepare(sql).all(...parametri).map(riepilogo));
});

/**
 * Le manifestazioni con tutte le loro edizioni, dalla più recente.
 * È la vista naturale: "Pharmexpo" con dentro 2025 e 2026.
 */
router.get('/raggruppate', (_req, res) => {
  const edizioni = db.prepare('SELECT * FROM fiere ORDER BY anno DESC, data_inizio DESC')
    .all().map(riepilogo);
  const gruppi = new Map();
  for (const edizione of edizioni) {
    const chiave = edizione.manifestazione || edizione.nome;
    if (!gruppi.has(chiave)) gruppi.set(chiave, []);
    gruppi.get(chiave).push(edizione);
  }
  const risultato = [...gruppi.entries()].map(([manifestazione, righe]) => ({
    manifestazione,
    edizioni: righe,
    pezzi_totali: righe.reduce((t, e) => t + e.pezzi_totali, 0),
    valore_totale: Math.round(righe.reduce((t, e) => t + e.valore, 0) * 100) / 100,
    prossima: righe.find((e) => e.stato !== 'conclusa' && e.stato !== 'annullata') || null,
  }));
  // Prima le manifestazioni con un'edizione in arrivo, poi le altre per data.
  risultato.sort((a, b) => {
    if (Boolean(a.prossima) !== Boolean(b.prossima)) return a.prossima ? -1 : 1;
    if (a.prossima && b.prossima) return a.prossima.data_inizio.localeCompare(b.prossima.data_inizio);
    return b.edizioni[0].data_inizio.localeCompare(a.edizioni[0].data_inizio);
  });
  res.json(risultato);
});

router.get('/:id', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const noleggi = db.prepare(`
    SELECT n.*, p.nome AS prodotto_nome, p.categoria AS prodotto_categoria,
           p.pollici AS prodotto_pollici, p.quantita AS prodotto_quantita
      FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
     WHERE n.fiera_id = ? ORDER BY p.categoria, p.nome`).all(fiera.id);
  res.json({ ...riepilogo(fiera), noleggi });
});

router.post('/', (req, res) => {
  const dati = leggiCorpo(req.body);
  const adesso = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO fiere (nome, manifestazione, anno, cliente, luogo, citta, padiglione, stand,
                       data_inizio, data_fine, giorni_allestimento, giorni_smontaggio,
                       stato, note, creato_il, aggiornato_il)
    VALUES (@nome, @manifestazione, @anno, @cliente, @luogo, @citta, @padiglione, @stand,
            @data_inizio, @data_fine, @giorni_allestimento, @giorni_smontaggio,
            @stato, @note, @creato_il, @aggiornato_il)`)
    .run({ ...dati, creato_il: adesso, aggiornato_il: adesso });
  res.status(201).json(riepilogo(trovaFiera(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const dati = leggiCorpo(req.body);
  db.prepare(`
    UPDATE fiere SET nome=@nome, manifestazione=@manifestazione, anno=@anno,
                     cliente=@cliente, luogo=@luogo, citta=@citta,
                     padiglione=@padiglione, stand=@stand, data_inizio=@data_inizio,
                     data_fine=@data_fine, giorni_allestimento=@giorni_allestimento,
                     giorni_smontaggio=@giorni_smontaggio, stato=@stato, note=@note,
                     aggiornato_il=@aggiornato_il
     WHERE id=@id`)
    .run({ ...dati, id: fiera.id, aggiornato_il: new Date().toISOString() });
  res.json(riepilogo(trovaFiera(fiera.id)));
});

router.delete('/:id', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  db.prepare('DELETE FROM noleggi WHERE fiera_id = ?').run(fiera.id);
  db.prepare('DELETE FROM fiere WHERE id = ?').run(fiera.id);
  res.json({ ok: true });
});

// Date suggerite per un nuovo noleggio su questa fiera (con allestimento/smontaggio).
router.get('/:id/finestra', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const { from, to } = finestraLogistica(fiera);
  res.json({ data_inizio: from, data_fine: to, oggi: oggi() });
});

export default router;
