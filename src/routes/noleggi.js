import { Router } from 'express';
import db from '../lib/db.js';
import {
  STATI_NOLEGGIO, MONTAGGI, HttpError,
  testo, intero, decimale, enumerato, periodo, giorniTra, isData,
} from '../lib/domain.js';
import { verificaCapienza } from '../lib/disponibilita.js';
import { trovaProdotto } from './prodotti.js';
import { trovaFiera, finestraLogistica } from './fiere.js';
import { sincronizzaPiantane, sganciaPiantane, avvisoPiantane } from '../lib/piantane.js';
import { leggiPosizione, allegatoDellaFiera, salvaSegnaposto } from '../lib/segnaposti.js';

const router = Router();

function trovaNoleggio(id) {
  const noleggio = db.prepare('SELECT * FROM noleggi WHERE id = ?').get(id);
  if (!noleggio) throw new HttpError(404, 'Noleggio non trovato.');
  return noleggio;
}

function arricchisci(noleggio) {
  const giorni = giorniTra(noleggio.data_inizio, noleggio.data_fine);
  return {
    ...noleggio,
    giorni,
    // Utile per confrontare noleggi di durata diversa a colpo d'occhio.
    importo_giorno: Math.round((noleggio.importo / giorni) * 100) / 100,
  };
}

function leggiCorpo(body) {
  const { inizio, fine } = periodo(body);
  const prodotto = trovaProdotto(intero(body.prodotto_id, 'prodotto_id', { min: 1 }));
  const fiera = trovaFiera(intero(body.fiera_id, 'fiera_id', { min: 1 }));
  if (prodotto.stato === 'dismesso') {
    throw new HttpError(409, `"${prodotto.nome}" è dismesso e non può essere noleggiato.`);
  }
  return {
    prodotto,
    fiera,
    dati: {
      prodotto_id: prodotto.id,
      fiera_id: fiera.id,
      cliente: testo(body.cliente, 'cliente', { max: 120 }),
      stand: testo(body.stand, 'stand', { max: 120 }),
      padiglione: testo(body.padiglione, 'padiglione', { max: 40 }),
      quantita: intero(body.quantita, 'quantita', { min: 1, max: 9999, predefinito: 1 }),
      data_inizio: inizio,
      data_fine: fine,
      stato: enumerato(body.stato, 'stato', STATI_NOLEGGIO, 'prenotato'),
      // Importo a forfait del lavoro: è così che vengono quotati i noleggi.
      // Se non indicato si propone il listino del prodotto per i giorni scelti.
      // Se non indicato: il prezzo a fiera del listino, o in mancanza quello al giorno.
      importo: body.importo === '' || body.importo == null
        ? Math.round((prodotto.prezzo_fiera > 0
          ? prodotto.prezzo_fiera
          : prodotto.prezzo_giorno * giorniTra(inizio, fine))
            * intero(body.quantita, 'quantita', { min: 1, max: 9999, predefinito: 1 }) * 100) / 100
        : decimale(body.importo, 'importo', { min: 0 }),
      note: testo(body.note, 'note', { max: 2000 }),
      montaggio: enumerato(body.montaggio, 'montaggio', MONTAGGI, ''),
      note_tecnico: testo(body.note_tecnico, 'note per il tecnico', { max: 500 }),
    },
  };
}

// Impedisce l'overbooking: la quantità richiesta deve stare nello stock libero.
function controllaDisponibilita({ prodotto, dati, escludiNoleggio = null }) {
  if (dati.stato === 'annullato' || dati.stato === 'rientrato') return;
  if (prodotto.stato === 'manutenzione') {
    throw new HttpError(409, `"${prodotto.nome}" è in manutenzione: rimettilo attivo per noleggiarlo.`);
  }
  const esito = verificaCapienza({
    prodotto,
    quantita: dati.quantita,
    from: dati.data_inizio,
    to: dati.data_fine,
    escludiNoleggio,
  });
  if (!esito.ok) {
    const dettaglio = esito.picco > 0
      ? ` Nel periodo il picco di impegno è di ${esito.picco} pezzi, il ${esito.giornoPicco}.`
      : '';
    throw new HttpError(409,
      `Disponibilità insufficiente per "${prodotto.nome}": ne restano ${esito.disponibili} `
      + `su ${prodotto.quantita} nelle date scelte.${dettaglio}`);
  }
}

router.get('/', (req, res) => {
  const { stato, prodotto_id: prodottoId, fiera_id: fieraId, from, to } = req.query;
  const condizioni = [];
  const parametri = [];
  if (stato) { condizioni.push('n.stato = ?'); parametri.push(stato); }
  if (prodottoId) { condizioni.push('n.prodotto_id = ?'); parametri.push(prodottoId); }
  if (fieraId) { condizioni.push('n.fiera_id = ?'); parametri.push(fieraId); }
  if (isData(from) && isData(to)) {
    condizioni.push('n.data_inizio <= ? AND n.data_fine >= ?');
    parametri.push(to, from);
  }
  if (req.query.q) {
    condizioni.push('(n.cliente LIKE ? OR n.stand LIKE ? OR p.nome LIKE ? OR f.nome LIKE ?)');
    const like = `%${req.query.q}%`;
    parametri.push(like, like, like, like);
  }
  let sql = `
    SELECT n.*, p.nome AS prodotto_nome, p.categoria AS prodotto_categoria,
           p.pollici AS prodotto_pollici, p.marca AS prodotto_marca, p.codice AS prodotto_codice,
           f.nome AS fiera_nome, f.citta AS fiera_citta, f.stato AS fiera_stato, f.padiglione AS fiera_padiglione,
           (SELECT tp.codice FROM noleggi t JOIN prodotti tp ON tp.id = t.prodotto_id WHERE t.id = n.abbinato_a) AS abbinato_codice,
           f.data_inizio AS fiera_inizio, f.data_fine AS fiera_fine,
           s.allegato_id AS segnaposto_allegato
      FROM noleggi n
      JOIN prodotti p ON p.id = n.prodotto_id
      JOIN fiere    f ON f.id = n.fiera_id
      LEFT JOIN segnaposti s ON s.noleggio_id = n.id`;
  if (condizioni.length) sql += ` WHERE ${condizioni.join(' AND ')}`;
  sql += ' ORDER BY n.data_inizio DESC, n.id DESC';
  res.json(db.prepare(sql).all(...parametri).map(arricchisci));
});

function inserisci(dati) {
  const adesso = new Date().toISOString();
  return db.prepare(`
    INSERT INTO noleggi (prodotto_id, fiera_id, cliente, stand, padiglione, quantita, data_inizio,
                         data_fine, stato, importo, note, montaggio, note_tecnico, creato_il, aggiornato_il)
    VALUES (@prodotto_id, @fiera_id, @cliente, @stand, @padiglione, @quantita, @data_inizio,
            @data_fine, @stato, @importo, @note, @montaggio, @note_tecnico, @creato_il, @aggiornato_il)`)
    .run({ ...dati, creato_il: adesso, aggiornato_il: adesso }).lastInsertRowid;
}

router.post('/', (req, res) => {
  const { prodotto, dati } = leggiCorpo(req.body);
  controllaDisponibilita({ prodotto, dati });
  const id = inserisci(dati);
  const piantane = sincronizzaPiantane(id);
  res.status(201).json({ ...arricchisci(trovaNoleggio(id)), avviso: avvisoPiantane(piantane) });
});

// Un apparecchio trascinato sulla planimetria: nasce un noleggio da un pezzo,
// con le date della fiera (allestimento e smontaggio compresi) e il punto
// dove montarlo. Stand e cliente arrivano dalla pianta, se riconosciuti.
router.post('/sulla-pianta', (req, res) => {
  const fiera = trovaFiera(intero(req.body?.fiera_id, 'fiera_id', { min: 1 }));
  const allegato = allegatoDellaFiera(req.body?.allegato_id, fiera.id);
  const posizione = leggiPosizione(req.body);
  const { from, to } = finestraLogistica(fiera);
  const { prodotto, dati } = leggiCorpo({
    prodotto_id: req.body?.prodotto_id,
    fiera_id: fiera.id,
    cliente: req.body?.cliente,
    stand: req.body?.stand,
    padiglione: req.body?.padiglione,
    quantita: 1,
    data_inizio: from,
    data_fine: to,
  });
  controllaDisponibilita({ prodotto, dati });
  const id = db.transaction(() => {
    const nuovo = inserisci(dati);
    salvaSegnaposto(nuovo, allegato.id, posizione);
    return nuovo;
  })();
  const piantane = sincronizzaPiantane(id);
  res.status(201).json({ ...arricchisci(trovaNoleggio(id)), avviso: avvisoPiantane(piantane) });
});

// Spostare il segnaposto di un noleggio (anche su un'altra planimetria della stessa fiera).
router.put('/:id/segnaposto', (req, res) => {
  const noleggio = trovaNoleggio(req.params.id);
  const allegato = allegatoDellaFiera(req.body?.allegato_id, noleggio.fiera_id);
  res.json(salvaSegnaposto(noleggio.id, allegato.id, leggiPosizione(req.body)));
});

// Togliere il noleggio dalla pianta: il noleggio resta.
router.delete('/:id/segnaposto', (req, res) => {
  const noleggio = trovaNoleggio(req.params.id);
  db.prepare('DELETE FROM segnaposti WHERE noleggio_id = ?').run(noleggio.id);
  res.json({ ok: true });
});

router.put('/:id', (req, res) => {
  const noleggio = trovaNoleggio(req.params.id);
  const { prodotto, dati } = leggiCorpo(req.body);
  controllaDisponibilita({ prodotto, dati, escludiNoleggio: noleggio.id });
  db.prepare(`
    UPDATE noleggi SET prodotto_id=@prodotto_id, fiera_id=@fiera_id, cliente=@cliente,
                       stand=@stand, padiglione=@padiglione, quantita=@quantita, data_inizio=@data_inizio,
                       data_fine=@data_fine, stato=@stato, importo=@importo,
                       note=@note, montaggio=@montaggio, note_tecnico=@note_tecnico,
                       aggiornato_il=@aggiornato_il
     WHERE id=@id`)
    .run({ ...dati, id: noleggio.id, aggiornato_il: new Date().toISOString() });
  const piantane = sincronizzaPiantane(noleggio.id);
  res.json({ ...arricchisci(trovaNoleggio(noleggio.id)), avviso: avvisoPiantane(piantane) });
});

// Cambio di stato rapido dalla lista (prenotato → consegnato → rientrato).
router.patch('/:id/stato', (req, res) => {
  const noleggio = trovaNoleggio(req.params.id);
  const stato = enumerato(req.body?.stato, 'stato', STATI_NOLEGGIO);
  if (['prenotato', 'consegnato'].includes(stato)
      && !['prenotato', 'consegnato'].includes(noleggio.stato)) {
    // Riattivare una riga chiusa rimette in gioco dei pezzi: va ricontrollata.
    const prodotto = trovaProdotto(noleggio.prodotto_id);
    controllaDisponibilita({
      prodotto,
      dati: { ...noleggio, stato },
      escludiNoleggio: noleggio.id,
    });
  }
  db.prepare('UPDATE noleggi SET stato = ?, aggiornato_il = ? WHERE id = ?')
    .run(stato, new Date().toISOString(), noleggio.id);
  // La piantana di un TV segue il suo stato (consegnata, rientrata…).
  const piantane = sincronizzaPiantane(noleggio.id);
  res.json({ ...arricchisci(trovaNoleggio(noleggio.id)), avviso: avvisoPiantane(piantane) });
});

router.delete('/:id', (req, res) => {
  const noleggio = trovaNoleggio(req.params.id);
  sganciaPiantane(noleggio.id);
  db.prepare('DELETE FROM noleggi WHERE id = ?').run(noleggio.id);
  res.json({ ok: true });
});

export default router;
