import express, { Router } from 'express';
import db from '../lib/db.js';
import * as archivio from '../lib/allegati.js';
import {
  STATI_FIERA, STATI_IMPEGNATIVI, HttpError,
  testo, intero, enumerato, periodo, addGiorni, giorniTra, oggi,
} from '../lib/domain.js';
import { impegnoMassimo } from '../lib/disponibilita.js';

const router = Router();

function leggiCorpo(body, idCorrente = null) {
  const { inizio, fine } = periodo(body);
  const scritta = testo(body.manifestazione, 'manifestazione', { obbligatorio: true, max: 120 });
  const esistente = db.prepare(`
    SELECT manifestazione FROM fiere
     WHERE lower(manifestazione) = lower(?) AND id IS NOT ? LIMIT 1`).get(scritta, idCorrente);
  const manifestazione = esistente?.manifestazione || scritta;
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

const perElenco = (a, fieraId) => ({
  id: a.id,
  nome: a.nome_originale,
  tipo: a.tipo,
  dimensione: a.dimensione,
  creato_il: a.creato_il,
  url: `/api/fiere/${fieraId}/allegati/${a.id}`,
});

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
     ORDER BY f.data_inizio ASC`).all(fiera.manifestazione, fiera.id);

  return {
    ...fiera,
    ...finestraLogistica(fiera),
    altre_edizioni: precedenti.map((e) => ({ ...e, valore: Math.round(e.valore * 100) / 100 })),
    durata_giorni: giorniTra(fiera.data_inizio, fiera.data_fine),
    pezzi_totali: attivi.reduce((tot, r) => tot + r.quantita, 0),
    righe_noleggio: attivi.length,
    clienti: new Set(attivi.map((r) => r.cliente).filter(Boolean)).size,
    num_allegati: db.prepare('SELECT COUNT(*) AS n FROM allegati WHERE fiera_id = ?').get(fiera.id).n,
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
  // Prima quelle in programma, poi le già svolte; sempre in ordine di calendario.
  sql += ` ORDER BY (data_fine >= date('now')) DESC, data_inizio ASC`;
  res.json(db.prepare(sql).all(...parametri).map(riepilogo));
});

/**
 * Le manifestazioni con tutte le loro edizioni, in ordine di calendario.
 * È la vista naturale: "Pharmexpo" con dentro 2025 e 2026.
 */
// In ordine di calendario: prima quella che viene prima.
const inOrdineDiData = (a, b) => a.data_inizio.localeCompare(b.data_inizio) || a.id - b.id;

router.get('/raggruppate', (_req, res) => {
  const edizioni = db.prepare('SELECT * FROM fiere ORDER BY data_inizio ASC')
    .all().map(riepilogo);
  const gruppi = new Map();
  for (const edizione of edizioni) {
    const chiave = edizione.manifestazione || edizione.nome;
    if (!gruppi.has(chiave)) gruppi.set(chiave, []);
    gruppi.get(chiave).push(edizione);
  }
  const risultato = [...gruppi.entries()].map(([manifestazione, righe]) => ({
    manifestazione,
    edizioni: [...righe].sort(inOrdineDiData),
    pezzi_totali: righe.reduce((t, e) => t + e.pezzi_totali, 0),
    valore_totale: Math.round(righe.reduce((t, e) => t + e.valore, 0) * 100) / 100,
    // La prossima è la più vicina ancora da svolgere, non la più recente per anno:
    // con 2026 e 2027 entrambe in programma, conta la 2026.
    prossima: righe
      .filter((e) => e.stato !== 'conclusa' && e.stato !== 'annullata' && e.data_fine >= oggi())
      .sort((a, b) => a.data_inizio.localeCompare(b.data_inizio))[0] || null,
  }));
  // Prima le fiere con un'edizione in programma, dalla più vicina; poi quelle
  // già svolte, anche loro in ordine di calendario.
  const ultima = (g) => g.edizioni[g.edizioni.length - 1].data_inizio;
  risultato.sort((a, b) => {
    if (Boolean(a.prossima) !== Boolean(b.prossima)) return a.prossima ? -1 : 1;
    if (a.prossima && b.prossima) return a.prossima.data_inizio.localeCompare(b.prossima.data_inizio);
    return ultima(a).localeCompare(ultima(b));
  });
  res.json(risultato);
});

router.get('/:id', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const noleggi = db.prepare(`
    SELECT n.*, p.nome AS prodotto_nome, p.categoria AS prodotto_categoria,
           p.pollici AS prodotto_pollici, p.quantita AS prodotto_quantita,
           p.marca AS prodotto_marca, p.codice AS prodotto_codice
      FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
     WHERE n.fiera_id = ? ORDER BY p.categoria, p.nome`).all(fiera.id);
  const allegati = db.prepare('SELECT * FROM allegati WHERE fiera_id = ? ORDER BY creato_il DESC')
    .all(fiera.id).map((a) => perElenco(a, fiera.id));
  res.json({ ...riepilogo(fiera), noleggi, allegati });
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
  const dati = leggiCorpo(req.body, fiera.id);
  const prima = finestraLogistica(fiera);
  const dopo = finestraLogistica(dati);

  // I noleggi che seguono le date della fiera devono spostarsi con lei,
  // altrimenti la disponibilità resta calcolata sulle date vecchie. Quelli
  // con date proprie restano dove sono.
  const esito = db.transaction(() => {
    db.prepare(`
      UPDATE fiere SET nome=@nome, manifestazione=@manifestazione, anno=@anno,
                       cliente=@cliente, luogo=@luogo, citta=@citta,
                       padiglione=@padiglione, stand=@stand, data_inizio=@data_inizio,
                       data_fine=@data_fine, giorni_allestimento=@giorni_allestimento,
                       giorni_smontaggio=@giorni_smontaggio, stato=@stato, note=@note,
                       aggiornato_il=@aggiornato_il
       WHERE id=@id`)
      .run({ ...dati, id: fiera.id, aggiornato_il: new Date().toISOString() });

    if (prima.from === dopo.from && prima.to === dopo.to) return { spostati: 0, fermi: 0 };

    const daSpostare = db.prepare(`
      SELECT * FROM noleggi WHERE fiera_id = ? AND data_inizio = ? AND data_fine = ?`)
      .all(fiera.id, prima.from, prima.to);
    const fermi = db.prepare('SELECT COUNT(*) AS n FROM noleggi WHERE fiera_id = ?')
      .get(fiera.id).n - daSpostare.length;

    db.prepare(`
      UPDATE noleggi SET data_inizio = ?, data_fine = ?, aggiornato_il = ?
       WHERE fiera_id = ? AND data_inizio = ? AND data_fine = ?`)
      .run(dopo.from, dopo.to, new Date().toISOString(), fiera.id, prima.from, prima.to);

    // Si verifica dopo aver spostato tutto: controllare una riga alla volta
    // confronterebbe ognuna con le altre ancora sulle date vecchie.
    const prodotti = [...new Set(daSpostare
      .filter((n) => STATI_IMPEGNATIVI.includes(n.stato))
      .map((n) => n.prodotto_id))];
    for (const prodottoId of prodotti) {
      const prodotto = db.prepare('SELECT * FROM prodotti WHERE id = ?').get(prodottoId);
      const { picco, righe } = impegnoMassimo({ prodottoId, from: dopo.from, to: dopo.to });
      if (picco > prodotto.quantita) {
        const altri = righe.filter((r) => r.fiera_id !== fiera.id)
          .map((r) => `${r.cliente || 'un cliente'} (${r.fiera_nome})`);
        throw new HttpError(409,
          `Con le nuove date "${prodotto.nome}"${prodotto.codice ? ` (${prodotto.codice})` : ''} `
          + `sarebbe noleggiato due volte: nello stesso periodo è già assegnato a ${altri.join(', ')}. `
          + 'Le date non sono state cambiate: libera prima quell\'apparecchio o scegline un altro.');
      }
    }
    return { spostati: daSpostare.length, fermi };
  })();

  res.json({
    ...riepilogo(trovaFiera(fiera.id)),
    noleggi_spostati: esito.spostati,
    noleggi_con_date_proprie: esito.fermi,
  });
});

router.delete('/:id', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  db.prepare('DELETE FROM noleggi WHERE fiera_id = ?').run(fiera.id);
  db.prepare(`DELETE FROM posizioni_stand
               WHERE allegato_id IN (SELECT id FROM allegati WHERE fiera_id = ?)`).run(fiera.id);
  db.prepare('DELETE FROM allegati WHERE fiera_id = ?').run(fiera.id);
  db.prepare('DELETE FROM fiere WHERE id = ?').run(fiera.id);
  archivio.eliminaTuttiDellaFiera(fiera.id);
  res.json({ ok: true });
});

/* ---------- planimetrie e altri allegati ---------- */

function trovaAllegato(fiera, id) {
  const allegato = db.prepare('SELECT * FROM allegati WHERE id = ? AND fiera_id = ?').get(id, fiera.id);
  if (!allegato) throw new HttpError(404, 'Allegato non trovato.');
  return allegato;
}


router.get('/:id/allegati', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const righe = db.prepare('SELECT * FROM allegati WHERE fiera_id = ? ORDER BY creato_il DESC').all(fiera.id);
  res.json(righe.map((a) => perElenco(a, fiera.id)));
});

// Il file arriva così com'è nel corpo della richiesta, il nome in un'intestazione:
// niente moduli multipart da interpretare, e un file per richiesta.
router.post('/:id/allegati',
  express.raw({ type: () => true, limit: archivio.DIMENSIONE_MASSIMA }),
  (req, res) => {
    const fiera = trovaFiera(req.params.id);
    let nome = '';
    try { nome = decodeURIComponent(req.get('x-nome-file') || ''); } catch { nome = ''; }
    const salvato = archivio.salva({ fieraId: fiera.id, buffer: req.body, nomeOriginale: nome });
    const info = db.prepare(`
      INSERT INTO allegati (fiera_id, nome_originale, nome_file, tipo, dimensione, creato_il)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(fiera.id, salvato.nomeOriginale, salvato.nomeFile, salvato.mime, salvato.dimensione,
        new Date().toISOString());
    const allegato = db.prepare('SELECT * FROM allegati WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(perElenco(allegato, fiera.id));
  });

router.get('/:id/allegati/:allegato', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  archivio.invia(res, fiera.id, trovaAllegato(fiera, req.params.allegato));
});

/* Posizioni degli stand messe a mano su una planimetria. x e y sono frazioni
   (0-1) della pagina, così non dipendono dallo zoom con cui la si guarda. */

router.get('/:id/allegati/:allegato/posizioni', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const allegato = trovaAllegato(fiera, req.params.allegato);
  res.json(db.prepare('SELECT chiave, pagina, x, y FROM posizioni_stand WHERE allegato_id = ?')
    .all(allegato.id));
});

router.put('/:id/allegati/:allegato/posizioni/:chiave', express.json(), (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const allegato = trovaAllegato(fiera, req.params.allegato);
  const chiave = testo(req.params.chiave, 'chiave', { obbligatorio: true, max: 120 });
  const frazione = (v, campo) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new HttpError(400, `"${campo}" deve essere tra 0 e 1.`);
    return n;
  };
  const posizione = {
    pagina: intero(req.body?.pagina, 'pagina', { min: 1, max: 500, predefinito: 1 }),
    x: frazione(req.body?.x, 'x'),
    y: frazione(req.body?.y, 'y'),
  };
  db.prepare(`
    INSERT INTO posizioni_stand (allegato_id, chiave, pagina, x, y, aggiornato_il)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (allegato_id, chiave) DO UPDATE
       SET pagina = excluded.pagina, x = excluded.x, y = excluded.y, aggiornato_il = excluded.aggiornato_il`)
    .run(allegato.id, chiave, posizione.pagina, posizione.x, posizione.y, new Date().toISOString());
  res.json({ chiave, ...posizione });
});

router.delete('/:id/allegati/:allegato/posizioni/:chiave', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const allegato = trovaAllegato(fiera, req.params.allegato);
  db.prepare('DELETE FROM posizioni_stand WHERE allegato_id = ? AND chiave = ?')
    .run(allegato.id, req.params.chiave);
  res.json({ ok: true });
});

router.delete('/:id/allegati/:allegato', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const allegato = trovaAllegato(fiera, req.params.allegato);
  db.prepare('DELETE FROM posizioni_stand WHERE allegato_id = ?').run(allegato.id);
  db.prepare('DELETE FROM allegati WHERE id = ?').run(allegato.id);
  archivio.elimina(fiera.id, allegato.nome_file);
  res.json({ ok: true });
});

// Date suggerite per un nuovo noleggio su questa fiera (con allestimento/smontaggio).
router.get('/:id/finestra', (req, res) => {
  const fiera = trovaFiera(req.params.id);
  const { from, to } = finestraLogistica(fiera);
  res.json({ data_inizio: from, data_fine: to, oggi: oggi() });
});

export default router;
